/*
 The MIT License (MIT)

 Copyright (c) 2014 Kasper Sandin

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
*/

var ReactUpdates = require('react/lib/ReactUpdates');

var DistributedBatchingStrategy = {
    frameBudget: 1000 / 60,
    pendingUpdates: [],
    isBatchingUpdates: false,

    batchedUpdates: function (enqueueUpdate, component, callback) {
        // Execute top level events right away since we don't know how to estimate them.
        // (without estimation the updates are always separated into one frame each)
        if (component.constructor.name == "TopLevelCallbackBookKeeping") {
            enqueueUpdate(component, callback);
            return;
        }

        this.pendingUpdates.push({enqueue: enqueueUpdate, component: component, callback: callback});
        this.requestFrameUpdate();
    },
    requestFrameUpdate: function () {
        // Only allow one frame request at a time
        if (!this.isRequestingFrameUpdate) {
            this.isRequestingFrameUpdate = true;
            requestAnimationFrame(this.performFrameUpdates.bind(this));
        }
    },
    performFrameUpdates: function () {
        // Allow frame update requests again
        this.isRequestingFrameUpdate = false;

        var remainingFrameBudget = this.frameBudget;

        // Start with updates we estimate to be done within the frame budget
        var promisingUpdates = this.splicePromisingUpdates();
        if (promisingUpdates.length > 0) {
            remainingFrameBudget -= this.performUpdates(promisingUpdates);
        }

        // Perform as many of the remaining updates as possible within the remaining frame budget
        while (this.pendingUpdates.length > 0 && remainingFrameBudget > 0) {
            var estimatedUpdateTime = this.pendingUpdates[0].component._estimatedUpdateTime || 0;

            // Stop updating early if we estimate following update to break the budget
            if (estimatedUpdateTime > remainingFrameBudget) {
                break;
            }

            // Perform updates and update remaining frame budget
            remainingFrameBudget -= this.performUpdates([this.pendingUpdates.shift()]);
        }

        // Worst case scenario: Force an update if no updates fit the frame budget.
        // (we can't separate an update into multiple updates, sadly).
        if (remainingFrameBudget === this.frameBudget && this.pendingUpdates.length > 0) {
            this.performUpdates([this.pendingUpdates.shift()]);
        }

        // Perform remaining updates next frame
        if (this.pendingUpdates.length > 0) {
            this.requestFrameUpdate();
        }
    },
    performUpdates: function (updates) {
        // Enqueue the updates by bypassing the batching strategy
        this.isBatchingUpdates = true;
        updates.forEach(function (update) {
            update.enqueue(update.component, update.callback);
        });
        this.isBatchingUpdates = false;

        // Flush and measure time spent
        var startTime = performance.now();
        ReactUpdates.flushBatchedUpdates();
        var timeSpent = performance.now() - startTime;

        // Estimate time spent on each component and store it to be able to estimate promising updates
        var estimatedUpdateTime = timeSpent;
        updates.forEach(function (update) {
            update.component._hasUpdateEstimation = true;
            update.component._estimatedUpdateTime = estimatedUpdateTime;
        });

        return timeSpent;
    },
    splicePromisingUpdates: function () {
        // Sort the updates we have estimations on first
        this.pendingUpdates.sort(function (a, b) {
            var aTime = a.component._hasUpdateEstimation ? a.component._estimatedUpdateTime : Number.MAX_VALUE;
            var bTime = b.component._hasUpdateEstimation ? b.component._estimatedUpdateTime : Number.MAX_VALUE;
            return aTime - bTime;
        });

        // Count how many updates we estimate to be able to finish within the frame budget
        var count;
        var thisTotal;
        var update;
        var totalEstimatedUpdateTime = 0;
        var nPendingUpdates = this.pendingUpdates.length;

        for (count = 0; count < nPendingUpdates; count++) {
            update = this.pendingUpdates[count];
            if (!update.component._hasUpdateEstimation) {
                break;
            }
            thisTotal = totalEstimatedUpdateTime + update.component._estimatedUpdateTime;
            if (thisTotal > this.frameBudget) {
                break;
            }
            totalEstimatedUpdateTime = thisTotal;
        }

        // Splice from pending since we will perform these updates separately
        return this.pendingUpdates.splice(0, count);
    }
};

module.exports = DistributedBatchingStrategy;
