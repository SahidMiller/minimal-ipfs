"use strict";

import toUri from "multiaddr-to-uri";
import CID from "cids";

import shuffle from "array-shuffle";
import { AbortController } from "native-abort-controller";
import hashlru from "hashlru";
import PQueue from "p-queue";

// browsers limit concurrent connections per host,
// we don't want preload calls to exhaust the limit (~6)
const httpQueue = new PQueue({ concurrency: 4 });

function preload(url, options = {}) {
  return httpQueue.add(async () => {
    const res = await fetch(url, { method: "POST", signal: options.signal });

    const reader = res.body.getReader();

    try {
      while (true) {
        const { done } = await reader.read();
        if (done) return;
        // Read to completion but do not cache
      }
    } finally {
      reader.releaseLock();
    }
  });
}

export default class Preloader {
  constructor(options = { enabled: true }) {
    this.apiUris = options.addresses.map(toUri);

    // Avoid preloading the same CID over and over again
    this.cache = hashlru(options.cache || 1000);

    this.requests = [];
  }

  /**
   * @param {string|CID} path
   * @returns {Promise<void>}
   */
  async preload(path) {
    if (typeof path !== "string") {
      path = new CID(path).toString();
    }

    // we've preloaded this recently, don't preload it again
    if (this.cache.has(path)) return;

    // make sure we don't preload this again any time soon
    this.cache.set(path, true);

    const fallbackApiUris = shuffle(this.apiUris);

    let success = false;
    const now = Date.now();

    for (const uri of fallbackApiUris) {
      let controller;

      try {
        controller = new AbortController();
        this.requests = this.requests.concat(controller);
        await preload(
          `${uri}/api/v0/refs?r=true&arg=${encodeURIComponent(path)}`,
          { signal: controller.signal }
        );
        success = true;
      } finally {
        this.requests = this.requests.filter((r) => r !== controller);
      }

      if (success) break;
    }
  }

  async stop() {
    this.requests.forEach((r) => r.abort());
    this.requests = [];
  }
}
