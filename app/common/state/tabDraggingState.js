/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/
*/
const { createSelector } = require('reselect')
const {getCurrentWindowId} = require('../../renderer/currentWindow')

const stateKey = 'tabDragData'

const dragDataSelector = state => state.get(stateKey)

const dragDetachedWindowIdSelector = createSelector(
  dragDataSelector,
  dragState => dragState && dragState.get('dragDetachedWindowId')
)

const tabDraggingState = {
  isCurrentWindowDetached: createSelector(
    // re-run next function only if dragDetachedWindowId changes
    dragDetachedWindowIdSelector,
    detachedWindowId =>
      detachedWindowId && detachedWindowId === getCurrentWindowId()
  )
}

module.exports = tabDraggingState
