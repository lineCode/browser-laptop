/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const appConstants = require('../../../js/constants/appConstants')
const appActions = require('../../../js/actions/appActions')
const { BrowserWindow, screen } = require('electron')
const tabState = require('../../common/state/tabState')
const tabDraggingState = require('../../common/state/tabDraggingState')
const browserWindowUtil = require('../../common/lib/browserWindowUtil')
const { makeImmutable } = require('../../common/state/immutableUtil')
const {frameOptsFromFrame} = require('../../../js/state/frameStateUtil')
const tabs = require('../tabs')
const windows = require('../windows')


const stateKey = 'tabDragData'

const reducer = (state, action, immutableAction) => {
  action = immutableAction || makeImmutable(action)
  switch (action.get('actionType')) {
    case appConstants.APP_TAB_DRAG_STARTED: {
      // calculate frame size based on difference
      // between where client reports a screen coordinate is
      // and where we think a screen coordinate would be
      const dragSourceData = action.get('dragSourceData')
      const sourceWindowId = dragSourceData.get('originalWindowId')
      const clientX = dragSourceData.get('originClientX')
      const clientY = dragSourceData.get('originClientY')
      const screenX = dragSourceData.get('originScreenX')
      const screenY = dragSourceData.get('originScreenY')
      const sourceWindow = BrowserWindow.fromId(sourceWindowId)
      const [winX, winY] = sourceWindow.getPosition()
      const frameTopHeight = screenY - clientY - winY
      const frameLeftWidth = screenX - clientX - winX
      // replace state data
      state = state.set(stateKey, dragSourceData.merge({
        frameTopHeight,
        frameLeftWidth
      }))
      if (dragSourceData.get('originatedFromSingleTabWindow') === false) {
        setImmediate(() => {
          // TODO: create at app startup?
          const [width, height] = sourceWindow.getSize()
          const existingBufferWindow = windows.getDragBufferWindow()
          if (existingBufferWindow) {
            existingBufferWindow.setPosition(winX, winY)
            existingBufferWindow.setSize(width, height)
            console.log('----')
            console.log('THERE WAS AN EXISTING DRAG WINDOW', existingBufferWindow.id)
            console.log('----')
          } else {
            windows.createBufferWindow({ x: winX, y: winY, width, height })
          }
        })
      }
      // TODO: if linux, send mouse events
      // TODO: don't close any windows if mid-drag (to keep mouse events and window buffer)
      break
    }
    case appConstants.APP_TAB_DRAG_CANCELLED: {
      console.log('drag cancelled')
      // return to original position, original window
      // delete state data
      state = state.delete(stateKey)
      const bufferWin = windows.getDragBufferWindow()
      if (bufferWin && bufferWin.isVisible()) {
        bufferWin.hide()
      }
      break
    }
    case appConstants.APP_TAB_DRAG_COMPLETE: {
      console.log('drag complete')
      // delete state data
      state = state.delete(stateKey)
      const bufferWin = windows.getDragBufferWindow()
      if (bufferWin && bufferWin.isVisible()) {
        bufferWin.hide()
      }
      break
    }
    case appConstants.APP_TAB_DRAG_CHANGE_WINDOW_DISPLAY_INDEX: {
      const dragSourceData = state.get(stateKey)
      if (dragSourceData == null) {
        break
      }
      const sourceTabId = dragSourceData.get('sourceTabId')
      if (sourceTabId == null) {
        break
      }
      const attachRequested = dragSourceData.has('attachRequestedWindowId')
      const detachRequested = dragSourceData.has('detachToRequestedWindowId')
      if (attachRequested || detachRequested) {
        break
      }
      const tabCurrentWindowId = dragSourceData.get('currentWindowId')
      if (action.get('senderWindowId') !== tabCurrentWindowId) {
        break
      }
      const destinationDisplayIndex = action.get('destinationDisplayIndex')
      const destinationFrameIndex = action.get('destinationFrameIndex')
      const stateUpdate = {
        // cache what we're doing, so we don't repeat request to move tab
        // since it may take longer than it takes to fire mousemove multiple times
        displayIndexRequested: destinationDisplayIndex
      }
      // in case resulting in new component mount (e.g. if tab dragged to new page)
      // then tell it where mouse is
      if (action.get('requiresMouseUpdate')) {
        const currentWindowId = tabState.getWindowId(state, sourceTabId)
        const win = BrowserWindow.fromId(currentWindowId)
        const cursorWindowPoint = browserWindowUtil.getWindowClientPointAtCursor(win)
        stateUpdate.dragWindowClientX = cursorWindowPoint.x
        stateUpdate.dragWindowClientY = cursorWindowPoint.y
      }
      state = state.mergeIn([stateKey], stateUpdate)
      process.stdout.write(`POS-${sourceTabId}->${destinationFrameIndex}`)
      setImmediate(() => {
        process.stdout.write(`.`)
        tabs.setTabIndex(sourceTabId, destinationFrameIndex)
      })
      break
    }
    case appConstants.APP_TAB_ATTACHED: {
      process.stdout.write('-oTA-')
      const dragSourceData = state.get(stateKey)
      if (!dragSourceData) {
        break
      }
      const sourceTabId = dragSourceData.get('sourceTabId')
      const attachDestinationWindowId = dragSourceData.get('attachRequestedWindowId')
      const detachToRequestedWindowId = dragSourceData.get('detachToRequestedWindowId')
      // which window is tab attached to right now
      const currentWindowId = tabState.getWindowId(state, sourceTabId)
      // attach to an existing window with tabs
      if (attachDestinationWindowId != null) {
        if (currentWindowId !== attachDestinationWindowId) {
          process.stdout.write(`WAf${currentWindowId}-t${attachDestinationWindowId}`)
          // don't do anything if still waiting for tab attach
          break
        }
        console.timeEnd('attachRequested')
        process.stdout.write(`DA-${currentWindowId}`)
        // can continue processing drag mouse move events
        state = state.deleteIn([stateKey, 'attachRequestedWindowId'])
        state = state.deleteIn([stateKey, 'displayIndexRequested'])
        // give the renderer some location information as the mouse may not have moved since attach
        // it can manually drag the tab to where the mouse is, making any display index changes required
        const win = BrowserWindow.fromId(currentWindowId)
        const cursorWindowPoint = browserWindowUtil.getWindowClientPointAtCursor(win)
        state = state.mergeIn([stateKey], {
          currentWindowId,
          dragWindowClientX: cursorWindowPoint.x,
          dragWindowClientY: cursorWindowPoint.y
        })
        // move the buffer window so it's ready for any future detach
        // note that the buffer window is likely the single-tab window
        // that was dragged to the window the tab is now attached to
        const [ x, y ] = win.getPosition()
        const [ width, height ] = win.getSize()
        const bufferWin = windows.getDragBufferWindow()
        if (bufferWin) {
          bufferWin.setSize(width, height)
          bufferWin.setPosition(x, y)
          // DO NOT hide the buffer window, as it may have originated the drag
          // ...it will be hidden when the drag operation is complete
        }
        break
      }
      // detach from an existing window, and attach to a new (but buffered, so existing) window
      if (detachToRequestedWindowId != null) {
        // detect if we're attached to correct window yet
        // or we're getting phantom action from previous window
        // (which happens)
        if (currentWindowId !== detachToRequestedWindowId) {
          process.stdout.write(`WDa${currentWindowId}-t${detachToRequestedWindowId}`)
          // don't do anything, wait for the correct event
          break
        }
        console.timeEnd('detachRequested')
        process.stdout.write(`DDa-${currentWindowId}`)
        // can continue processing mousemove events
        state = state.deleteIn([stateKey, 'detachedFromWindowId'])
        state = state.deleteIn([stateKey, 'detachToRequestedWindowId'])
        state = state.deleteIn([stateKey, 'displayIndexRequested'])
        state = state.setIn([stateKey, 'currentWindowId'], currentWindowId)
        state = state.setIn([stateKey, 'dragDetachedWindowId'], currentWindowId)
      }
      break
    }
    case appConstants.APP_TAB_DRAG_SINGLE_TAB_MOVED: {
      const yThreshold = 50
      const dragSourceData = state.get(stateKey)
      if (!dragSourceData) {
        // can get here because store somehow received the 'moved' action
        // before it receives the 'started' action
        break
      }
      const sourceTabId = dragSourceData.get('sourceTabId')
      const currentWindowId = dragSourceData.get('currentWindowId')
      // wait for any pending attach
      if (dragSourceData.has('attachRequestedWindowId')) {
        break
      }
      // wait for any pending detach
      if (dragSourceData.has('detachRequestedWindowId')) {
        break
        // window created event will fire, which will handle clearing this block
      }
      if (dragSourceData.has('detachToRequestedWindowId')) {
        console.log('not moving, detaching...')
        break
      }
      // even though new window has been created, it may not actuall be attached to the window we think it is
      const actualWindowId = tabState.getWindowId(state, sourceTabId)
      if (currentWindowId !== actualWindowId) {
        process.stdout.write(`WW-${currentWindowId}-${actualWindowId}`)
        break
      }
      // might get leftover calls from old windows just after detach
      const eventSourceWindowId = action.get('windowId')
      if (currentWindowId !== eventSourceWindowId) {
        process.stdout.write(`BTM-${currentWindowId}-${eventSourceWindowId}`)
        break
      }
      // find when to attach this tab to another window
      // we need all window positions
      // see if we're within each browsers X + width Y + relativeY +/- threshold
      const allWindows = BrowserWindow.getAllWindows()
      const currentTabWindow = BrowserWindow.fromId(currentWindowId)
      const otherWindows = allWindows.filter(win => win !== currentTabWindow)
      const clientTabY = action.get('tabY')
      // TODO: filter windows which are covered by other windows
      // and so are not visible to the user
      const mouseScreenPos = screen.getCursorScreenPoint()
      const intersectionWindow = otherWindows.find(win => {
        if (!win.isVisible()) {
          return false
        }
        const windowCursorClientPosition = browserWindowUtil.getWindowClientPointAtScreenPoint(win, mouseScreenPos)
        const winClientWidth = browserWindowUtil.getWindowClientSize(win).width
        if (
          windowCursorClientPosition.x > 0 &&
          windowCursorClientPosition.x < winClientWidth &&
          windowCursorClientPosition.y < clientTabY + (yThreshold / 2) &&
          windowCursorClientPosition.y > clientTabY - (yThreshold / 2)
        ) {
          return true
        }
      })
      if (intersectionWindow) {
        // found window should attach to
        const frameOpts = frameOptsFromFrame(dragSourceData.get('frame'))
        // remember the window we're waiting to attach to
        // also send that window's tab component the mouse position as it may
        // not receive a mousemove event after it sets it up (user mouse may be paused until
        // tab 'looks' attached)
        const cursorWindowPoint = browserWindowUtil.getWindowClientPointAtCursor(intersectionWindow, mouseScreenPos)
        state = state.mergeIn([stateKey], {
          dragWindowClientX: cursorWindowPoint.x,
          dragWindowClientY: cursorWindowPoint.y,
          attachRequestedWindowId: intersectionWindow.id
        })
        process.stdout.write(`A-${intersectionWindow.id}`)
        // TODO: windows which only have one tab will be
        // destroyed as soon as we attached that tab to another
        // window. And the original window the tab was in
        // is required to keep the drag event happening.
        // Until we support keeping that window hanging around, we'll
        // have to end the drag event now
        if (dragSourceData.get('originatedFromSingleTabWindow')) {
          // end the drag operation
          // state = state.delete(stateKey)
        }
        // attach
        setImmediate(() => {
          process.stdout.write('|')
          intersectionWindow.focus()
          // use existing window for drag buffer in case we're needed again
          // and also to keep the drag event going since it may
          // have been the originating window
          windows.setWindowIsDragBuffer(currentWindowId)
          console.time('attachRequested')
          tabs.moveTo(state, sourceTabId, frameOpts, {}, intersectionWindow.id)
        })
      } else {
        setImmediate(() => {
          process.stdout.write('M-')
          // only tab, move the position by delta
          const win = BrowserWindow.fromId(currentWindowId)
          const relativeTabX = dragSourceData.get('relativeXDragStart')
          const relativeTabY = dragSourceData.get('relativeYDragStart')
          const tabX = action.get('tabX')
          const tabY = action.get('tabY')
          const frameLeftWidth = dragSourceData.get('frameLeftWidth')
          const frameTopHeight = dragSourceData.get('frameTopHeight')
          const windowY = Math.floor(mouseScreenPos.y - tabY - frameTopHeight - relativeTabY)
          const windowX = Math.floor(mouseScreenPos.x - tabX - frameLeftWidth - relativeTabX)
          win.setPosition(windowX, windowY)
        })
      }
      break
    }
    case appConstants.APP_TAB_DRAG_DETACH_REQUESTED: {
      const dragSourceData = state.get(stateKey)
      if (!dragSourceData) {
        break
      }
      const sourceTabId = dragSourceData.get('sourceTabId')
      const currentWindowId = tabState.getWindowId(state, sourceTabId)
      // attach the tab to the buffer window, if it exists
      const bufferWindow = windows.getDragBufferWindow()
      const toWindowId = bufferWindow ? bufferWindow.id : -1
      // unmark the buffer window, since it's now a real window
      // note that if the tab is moved to another window again,
      // the window will be re-used as a buffer
      windows.clearWindowIsDragBuffer()
      setImmediate(() => {
        console.time('detachRequested')
        process.stdout.write('D-')
        const browserOpts = {
          checkMaximized: false
        }
        const frameOpts = frameOptsFromFrame(dragSourceData.get('frame'))
        tabs.moveTo(state, sourceTabId, frameOpts, browserOpts, toWindowId)
        // window should already be sized and positioned
        // exactly like the window we are detaching from
        // but we should animate so that the tab is where the mouse is
        // since there will have been some movement in order to detach
        if (toWindowId !== -1) {
          const relativeTabX = dragSourceData.get('relativeXDragStart')
          const relativeClientY = dragSourceData.get('originClientY')
          bufferWindow.show()
          const newPoint = browserWindowUtil.getWindowPositionForClientPointAtCursor({
            x: relativeTabX,
            y: relativeClientY
          })
          bufferWindow.setPosition(newPoint.x, newPoint.y, false)
          // const originalTabScreenPosition = browserWindowUtil.getScreenPointAtWindowClientPoint(bufferWindow, {
          //   x: action.get('tabX') - relativeTabX,
          //   y: action.get('tabY')
          // })
          // process.stdout.write('anim')
          // browserWindowUtil.animateWindowPosition(bufferWindow, {
          //   fromPoint: originalTabScreenPosition,
          //   // TODO include original tab parent bounds and assume new window will have tab group at same pos
          //   // (pinned tabs?)
          //   getDestinationPoint: () => browserWindowUtil.getWindowPositionForClientPointAtCursor({
          //     x: relativeTabX,
          //     y: relativeClientY
          //   })
          // })
        }
      })
      // remember that we have asked for a new window,
      // so that we do not try to create again
      const props = {
        detachedFromTabX: action.get('tabX'),
        detachedFromTabY: action.get('tabY'),
        detachedFromWindowId: currentWindowId
      }
      if (toWindowId !== -1) {
        props.detachToRequestedWindowId = toWindowId
      } else {
        props.detachRequestedWindowId = currentWindowId
      }
      state = state.mergeIn([stateKey], props)
      break
    }
  }
  return state
}

module.exports = reducer
