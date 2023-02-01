/*
 * This file is part of the TYPO3 CMS project.
 *
 * It is free software; you can redistribute it and/or modify it under
 * the terms of the GNU General Public License, either version 2
 * of the License, or any later version.
 *
 * For the full copyright and license information, please read the
 * LICENSE.txt file that was distributed with this source code.
 *
 * The TYPO3 project - inspiring people to share!
 */

import {html, LitElement, TemplateResult} from 'lit';
import {customElement, query} from 'lit/decorators';
import {FileStorageTree} from './file-storage-tree';
import '@typo3/backend/element/icon-element';
import {TreeNode} from '@typo3/backend/tree/tree-node';
import Persistent from '@typo3/backend/storage/persistent';
import ContextMenu from '../context-menu';
import {DragDropHandler, DragDrop, DraggablePositionEnum, DragDropTargetPosition} from './drag-drop';
import Modal from '../modal';
import Severity from '../severity';
import Notification from '../notification';
import AjaxRequest from '@typo3/core/ajax/ajax-request';
import {TreeNodeSelection, Toolbar} from '../svg-tree';
import {ModuleStateStorage} from '../storage/module-state-storage';
import {getRecordFromName} from '../module';

export const navigationComponentName: string = 'typo3-backend-navigation-component-filestoragetree';

/**
 * FileStorageTree which allows for drag+drop, and in-place editing, as well as
 * tree highlighting from the outside
 */
@customElement('typo3-backend-navigation-component-filestorage-tree')
class EditableFileStorageTree extends FileStorageTree {
  private readonly actionHandler: FileStorageTreeActions;

  public constructor() {
    super();
    this.actionHandler = new FileStorageTreeActions(this);
  }

  public updateNodeBgClass(nodesBg: TreeNodeSelection): TreeNodeSelection {
    return super.updateNodeBgClass.call(this, nodesBg).call(this.initializeDragForNode());
  }

  protected nodesUpdate(nodes: TreeNodeSelection): TreeNodeSelection {
    return super.nodesUpdate.call(this, nodes).call(this.initializeDragForNode());
  }

  /**
   * Initializes a drag&drop when called on the tree.
   */
  private initializeDragForNode() {
    return this.actionHandler.connectDragHandler(new FileStorageTreeNodeDragHandler(this, this.actionHandler))
  }
}

/**
 * Responsible for setting up the viewport for the Navigation Component for the File Tree
 */
@customElement(navigationComponentName)
export class FileStorageTreeNavigationComponent extends LitElement {
  @query('.svg-tree-wrapper') tree: EditableFileStorageTree;
  @query('typo3-backend-tree-toolbar') toolbar: Toolbar;

  public connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('typo3:filestoragetree:refresh', this.refresh);
    document.addEventListener('typo3:filestoragetree:selectFirstNode', this.selectFirstNode);
    // event listener updating current tree state, this can be removed in TYPO3 v12
    document.addEventListener('typo3:filelist:treeUpdateRequested', this.treeUpdateRequested);
  }

  public disconnectedCallback(): void {
    document.removeEventListener('typo3:filestoragetree:refresh', this.refresh);
    document.removeEventListener('typo3:filestoragetree:selectFirstNode', this.selectFirstNode);
    document.removeEventListener('typo3:filelist:treeUpdateRequested', this.treeUpdateRequested);
    super.disconnectedCallback();
  }

  // disable shadow dom for now
  protected createRenderRoot(): HTMLElement | ShadowRoot {
    return this;
  }

  protected render(): TemplateResult {
    const treeSetup = {
      dataUrl: top.TYPO3.settings.ajaxUrls.filestorage_tree_data,
      filterUrl: top.TYPO3.settings.ajaxUrls.filestorage_tree_filter,
      showIcons: true
    };

    return html`
      <div id="typo3-filestoragetree" class="svg-tree">
        <div>
          <typo3-backend-tree-toolbar .tree="${this.tree}" id="filestoragetree-toolbar" class="svg-toolbar"></typo3-backend-tree-toolbar>
          <div class="navigation-tree-container">
            <typo3-backend-navigation-component-filestorage-tree id="typo3-filestoragetree-tree" class="svg-tree-wrapper" .setup=${treeSetup}></typo3-backend-navigation-component-filestorage-tree>
          </div>
        </div>
        <div class="svg-tree-loader">
          <typo3-backend-icon identifier="spinner-circle-light" size="large"></typo3-backend-icon>
        </div>
      </div>
    `;
  }

  protected firstUpdated() {
    this.toolbar.tree = this.tree;
    this.tree.addEventListener('typo3:svg-tree:expand-toggle', this.toggleExpandState);
    this.tree.addEventListener('typo3:svg-tree:node-selected', this.loadContent);
    this.tree.addEventListener('typo3:svg-tree:node-context', this.showContextMenu);
    this.tree.addEventListener('typo3:svg-tree:nodes-prepared', this.selectActiveNode);
  }

  private refresh = (): void => {
    this.tree.refreshOrFilterTree();
  }

  private selectFirstNode = (): void => {
    const node = this.tree.nodes[0];
    if (node) {
      this.tree.selectNode(node, true);
    }
  }

  // event listener updating current tree state, this can be removed in TYPO3 v12
  private treeUpdateRequested = (evt: CustomEvent): void => {
    const identifier = encodeURIComponent(evt.detail.payload.identifier);
    let nodeToSelect = this.tree.nodes.filter((node: TreeNode) => { return node.identifier === identifier})[0];
    if (nodeToSelect && this.tree.getSelectedNodes().filter((selectedNode: TreeNode) => { return selectedNode.identifier === nodeToSelect.identifier; }).length === 0) {
      this.tree.selectNode(nodeToSelect, false);
    }
  }

  private toggleExpandState = (evt: CustomEvent): void => {
    const node = evt.detail.node as TreeNode;
    if (node) {
      Persistent.set('BackendComponents.States.FileStorageTree.stateHash.' + node.stateIdentifier, (node.expanded ? '1' : '0'));
    }
  }

  private loadContent = (evt: CustomEvent): void => {
    const node = evt.detail.node as TreeNode;
    if (!node?.checked) {
      return;
    }

    // remember the selected folder in the global state
    ModuleStateStorage.update('file', node.identifier, true);

    if (evt.detail.propagate === false) {
      return;
    }

    // Load the currently selected module with the updated URL
    const moduleMenu = top.TYPO3.ModuleMenu.App;
    let contentUrl = getRecordFromName(moduleMenu.getCurrentModule()).link;
    contentUrl += contentUrl.includes('?') ? '&' : '?';
    top.TYPO3.Backend.ContentContainer.setUrl(contentUrl + 'id=' + node.identifier);
  }

  private showContextMenu = (evt: CustomEvent): void => {
    const node = evt.detail.node as TreeNode;
    if (!node) {
      return;
    }
    ContextMenu.show(
      node.itemType,
      decodeURIComponent(node.identifier),
      'tree',
      '',
      '',
      this.tree.getElementFromNode(node)
    );
  }

  /**
   * Event listener called for each loaded node,
   * here used to mark node remembered in ModuleStateStorage as selected
   */
  private selectActiveNode = (evt: CustomEvent): void => {
    const selectedNodeIdentifier = ModuleStateStorage.current('file').selection;
    let nodes = evt.detail.nodes as Array<TreeNode>;
    evt.detail.nodes = nodes.map((node: TreeNode) => {
      if (node.identifier === selectedNodeIdentifier) {
        node.checked = true;
      }
      return node;
    });
  }
}

interface NodePositionOptions {
  node: TreeNode,
  target: TreeNode,
  identifier: string,
  position: DraggablePositionEnum
}

/**
 * Extends Drag&Drop functionality for File Storage Tree positioning when dropping
 * Works with and without d3.drag.
 */
class FileStorageTreeActions extends DragDrop {

  /**
   * returns true if the node that is currently active has the EXACT same parent node.
   * Typical use case: You cannot move a folder to the parent folder.
   */
  public isInSameParentNode(draggingNode: TreeNode, targetNode: TreeNode): boolean {
    return draggingNode.stateIdentifier == targetNode.stateIdentifier
      || draggingNode.parentsStateIdentifier[0] == targetNode.stateIdentifier
      || targetNode.parentsStateIdentifier.includes(draggingNode.stateIdentifier);
  }

  /**
   * Prepares all the details, which node is dropped on which other, if it is inside or before
   * the target node (= droppedNode).
   */
  public getDropCommandDetails(droppedNode: TreeNode, draggingNode: TreeNode): null|NodePositionOptions {
    const nodes = this.tree.nodes;
    const identifier = draggingNode.identifier;
    let position = this.tree.settings.nodeDragPosition;
    let target = droppedNode || draggingNode;

    if (identifier === target.identifier) {
      return null;
    }

    if (position === DraggablePositionEnum.BEFORE) {
      const index = nodes.indexOf(droppedNode);
      const positionAndTarget = this.setNodePositionAndTarget(index);
      if (positionAndTarget === null) {
        return null;
      }
      position = positionAndTarget.position;
      target = positionAndTarget.target;
    }

    return {
      node: draggingNode,
      identifier: identifier, // dragged node id
      target: target, // hovered node
      position: position // before, in, after
    }
  }

  /**
   * Returns position and target node where it should be added
   */
  public setNodePositionAndTarget(index: number): null|DragDropTargetPosition {
    const nodes = this.tree.nodes;
    const nodeOver = nodes[index];
    const nodeOverDepth = nodeOver.depth;
    if (index > 0) {
      index--;
    }
    const nodeBefore = nodes[index];
    const nodeBeforeDepth = nodeBefore.depth;
    const target = this.tree.nodes[index];

    if (nodeBeforeDepth === nodeOverDepth) {
      return {position: DraggablePositionEnum.AFTER, target};
    } else if (nodeBeforeDepth < nodeOverDepth) {
      return {position: DraggablePositionEnum.INSIDE, target};
    } else {
      for (let i = index; i >= 0; i--) {
        if (nodes[i].depth === nodeOverDepth) {
          return {position: DraggablePositionEnum.AFTER, target: this.tree.nodes[i]};
        } else if (nodes[i].depth < nodeOverDepth) {
          return {position: DraggablePositionEnum.AFTER, target: nodes[i]};
        }
      }
    }
    return null;
  }

  /**
   * Checks various conditions and updates the dragging element (CSS class) and the drag position
   * in order to show if a node can be dropped.
   *
   * @param draggingNode
   */
  public updateStateOfHoveredNode(draggingNode: TreeNode|null): void {
    this.tree.settings.nodeDragPosition = false;
    // Mouse is not on a node, deny
    if (!this.tree.hoveredNode) {
      this.addNodeDdClass('nodrop');
      return;
    }
    // Mouse is outside SVG, deny
    if (!this.tree.isOverSvg) {
      this.addNodeDdClass('nodrop');
      return;
    }
    // we are hovering over the currently dragged node, deny
    if (draggingNode.isOver || this.isTheSameNode(this.tree.hoveredNode, draggingNode)) {
      this.addNodeDdClass('nodrop');
      return;
    }
    // File storage specific, does not make sense to move into the same folder (we have it in the same folder)
    if (this.isInSameParentNode(draggingNode, this.tree.hoveredNode)) {
      this.addNodeDdClass('nodrop');
      return;
    }
    // All good
    this.addNodeDdClass('ok-append');
    this.tree.settings.nodeDragPosition = DraggablePositionEnum.INSIDE;
  }

  public isDropAllowed(hoveredNode: TreeNode, draggingNode: TreeNode): boolean {
    if (draggingNode.isOver) {
      return false;
    }
    if (this.isTheSameNode(hoveredNode, draggingNode)) {
      return false;
    }
    if (!this.tree.isOverSvg) {
      return false;
    }
    return true;
  }
}


/**
 * Drag and drop for nodes (copy/move)
 */
class FileStorageTreeNodeDragHandler implements DragDropHandler {
  public dragStarted: boolean = false;
  public startPageX: number = 0;
  public startPageY: number = 0;
  private tree: FileStorageTree;
  private actionHandler: FileStorageTreeActions;

  constructor(tree: FileStorageTree, actionHandler: FileStorageTreeActions) {
    this.tree = tree;
    this.actionHandler = actionHandler;
  }

  public onDragStart(event: MouseEvent, draggingNode: TreeNode|null): boolean {
    if (draggingNode.depth === 0) {
      return false;
    }
    this.startPageX = event.pageX;
    this.startPageY = event.pageY;
    this.dragStarted = false;
    return true;
  };

  public onDragOver(event: MouseEvent, draggingNode: TreeNode|null): boolean {
    if (this.actionHandler.isDragNodeDistanceMore(event, this)) {
      this.dragStarted = true;
    } else {
      return false;
    }

    if (draggingNode.depth === 0) {
      return false;
    }

    // Create the draggable = the shadowed element which follows the cursor
    if (!this.actionHandler.getDraggable()) {
      this.actionHandler.createDraggableFromExistingNode(draggingNode);
    }

    this.actionHandler.openNodeTimeout();
    this.actionHandler.updateDraggablePosition(event);

    // Calculate if the draggingNode is allowed to be dropped, and update the currently hovered node / bg for this
    this.actionHandler.updateStateOfHoveredNode(draggingNode);
    return true;
  }

  public onDrop(event: MouseEvent, draggingNode: TreeNode): boolean {
    if (!this.dragStarted || draggingNode.depth === 0) {
      return false;
    }

    this.actionHandler.cleanupDrop();
    if (this.actionHandler.isDropAllowed(this.tree.hoveredNode, draggingNode)) {
      let options = this.actionHandler.getDropCommandDetails(this.tree.hoveredNode, draggingNode);
      let modalText = options.position === DraggablePositionEnum.INSIDE ? TYPO3.lang['mess.move_into'] : TYPO3.lang['mess.move_after'];
      modalText = modalText.replace('%s', options.node.name).replace('%s', options.target.name);

      const modal = Modal.confirm(
        TYPO3.lang.move_folder,
        modalText,
        Severity.warning, [
          {
            text: TYPO3.lang['labels.cancel'] || 'Cancel',
            active: true,
            btnClass: 'btn-default',
            name: 'cancel'
          },
          {
            text: TYPO3.lang['cm.copy'] || 'Copy',
            btnClass: 'btn-warning',
            name: 'copy'
          },
          {
            text: TYPO3.lang['labels.move'] || 'Move',
            btnClass: 'btn-warning',
            name: 'move'
          }
        ]
      );
      modal.addEventListener('button.clicked', (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (target.name === 'move') {
          this.sendChangeCommand('move', options);
        } else if (target.name === 'copy') {
          this.sendChangeCommand('copy', options);
        }
        modal.hideModal();
      });
    }
    return true;
  }

  /**
   * When something a folder was drag+dropped, this will send an AJAX request to the server.
   */
  private sendChangeCommand(command: string, data: any): void {
    let params = {
      data: {}
    } as any;

    if (command === 'copy') {
      params.data.copy = [];
      params.data.copy.push({data: decodeURIComponent(data.identifier), target: decodeURIComponent(data.target.identifier)});
    } else if (command === 'move') {
      params.data.move = [];
      params.data.move.push({data: decodeURIComponent(data.identifier), target: decodeURIComponent(data.target.identifier)});
    } else {
      return;
    }

    this.tree.nodesAddPlaceholder();

    (new AjaxRequest(top.TYPO3.settings.ajaxUrls.file_process))
      .post(params)
      .then((response) => {
        return response.resolve();
      })
      .then((response) => {
        if (response && response.hasErrors) {
          this.tree.errorNotification(response.messages, false);
          this.tree.nodesContainer.selectAll('.node').remove();
          this.tree.updateVisibleNodes();
          this.tree.nodesRemovePlaceholder();
        } else {
          if (response.messages) {
            response.messages.forEach((message: any) => {
              Notification.showMessage(
                message.title || '',
                message.message || '',
                message.severity
              );
            });
          }
          this.tree.refreshOrFilterTree();
        }
      })
      .catch((error) => {
        this.tree.errorNotification(error, true);
      });
  }
}
