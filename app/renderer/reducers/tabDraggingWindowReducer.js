/* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this file,
* You can obtain one at http://mozilla.org/MPL/2.0/. */

const electron = require('electron')
const throttle = require('lodash.throttle')
const appConstants = require('../../../js/constants/appConstants')
const appActions = require('../../../js/actions/appActions')
const {getCurrentWindowId} = require('../currentWindow')
const browserWindowUtil = require('../../common/lib/browserWindowUtil')

module.exports = function (windowState, action) {
  switch (action.actionType) {
    case appConstants.APP_TAB_DRAG_STARTED:
      setupDragContinueEvents()
      break
  }
  return windowState
}

/// For when this tab / window is the dragging source
/// dispatch the events to the store so that the
/// other windows can receive state update of where to put the tab
function setupDragContinueEvents () {
  const stopDragListeningEvents = () => {
    window.removeEventListener('mouseup', onTabDragComplete)
    window.removeEventListener('keydown', onTabDragCancel)
    window.removeEventListener('mousemove', onTabDragMove)
  }
  const onTabDragComplete = e => {
    stopDragListeningEvents()
    appActions.tabDragComplete()
  }
  const onTabDragCancel = e => {
    if (e.keyCode === 27) { // ESC key
      stopDragListeningEvents()
      appActions.tabDragCancelled()
    }
  }
  const onTabDragMove = mouseMoveEvent => {
    mouseMoveEvent.preventDefault()
    reportMoveToOtherWindow(mouseMoveEvent)
  }
  window.addEventListener('mouseup', onTabDragComplete)
  window.addEventListener('keydown', onTabDragCancel)
  window.addEventListener('mousemove', onTabDragMove)
}

/// HACK Even if the other window is 'active', it will not receive regular mousemove events
/// ...probably because there is another mousemove event in progress generated from another
/// window.
/// So send the mouse events using muon's BrowserWindow.sendInputEvent
/// This was previously done in the browser process as a result of the 'dragMoved' store action
/// but it was never smooth enough, even when reducing the throttle time
const reportMoveToOtherWindow = throttle(mouseMoveEvent => {
  // HACK we cannot get the new window ID (tabDragData.currentWindowId) from the store state
  // when we are dragged to another window since our component will
  // not be subscribed to store updates anymore as technically it
  // does not exist, so...
  // ...get the currently focused window... if this is flakey we could subscribe to the store
  // manually (and probably create another higher order component for all this to preserve sanity)
  const win = electron.remote.BrowserWindow.getActiveWindow()
  if (!win || win.id === getCurrentWindowId()) {
    return
  }
  const {x: clientX, y: clientY} = browserWindowUtil.getWindowClientPointAtCursor(win, {
    x: mouseMoveEvent.screenX,
    y: mouseMoveEvent.screenY
  })
  win.webContents.sendInputEvent(createEventForSendMouseMoveInput(clientX, clientY))
}, 4)

// HACK mousemove will only trigger in the other window if the coords are inside the bounds but
// will trigger for this window even if the mouse is outside the window, since we started a dragEvent,
// *but* it will forward anything for globalX and globalY, so we'll send the client coords in those properties
// and send some fake coords in the clientX and clientY properties
// An alternative solution would be for the other window to just call electron API
// to get mouse cursor, and we could just send 0, 0 coords, but this reduces the spread of electron
// calls in components, and also puts the (tiny) computation in another process, freeing the other
// window to perform the animation
function createEventForSendMouseMoveInput (screenX, screenY) {
  return {
    type: 'mousemove',
    x: 1,
    y: 99,
    globalX: screenX,
    globalY: screenY
  }
}
