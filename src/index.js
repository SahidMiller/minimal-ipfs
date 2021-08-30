import Libp2p from "libp2p";

// Use any interface-datastore compliant store
import { MemoryDatastore } from "interface-datastore";
import websocketMaFilters from "libp2p-websockets/src/filters.js";
import { NOISE } from "libp2p-noise";
import MPLEX from "libp2p-mplex";
import WS from "libp2p-websockets";
import Bitswap from "ipfs-bitswap";
import Bootstrap from "libp2p-bootstrap";

import Preloader from "./preload.js";

import Repo from "ipfs-repo";
import BlockService from "ipfs-block-service";
import Ipld from "ipld";

const DAG_PB = 112;
const repo = new Repo("ipfs");
import mergeOptions from "merge-options";
import { Multiaddr } from "multiaddr";
import { dnsaddrResolver } from "multiaddr/src/resolvers/index.js";

export async function createPeer(options) {
  // Bring your own libp2p host....
  const host = await Libp2p.create(
    mergeOptions(
      {
        modules: {
          transport: [WS],
          connEncryption: [NOISE],
          streamMuxer: [MPLEX],
          peerDiscovery: [Bootstrap],
        },
        config: {
          peerDiscovery: {
            autoDial: true,
            bootstrap: {
              enabled: true,
              list: [
                "/dns4/node0.preload.ipfs.io/tcp/443/wss/p2p/QmZMxNdpMkewiVZLMRxaNxUeZpDUb34pWjZ1kZvsd16Zic",
                "/dns4/node1.preload.ipfs.io/tcp/443/wss/p2p/Qmbut9Ywz9YEDrz8ySBSgWyJk41Uvm2QJPhwDJzJyGFsD6",
                "/dns4/node2.preload.ipfs.io/tcp/443/wss/p2p/QmV7gnbW5VTcJ3oyM2Xk1rdFBJ3kTkvxc87UFGsun29STS",
                "/dns4/node3.preload.ipfs.io/tcp/443/wss/p2p/QmY7JB6MQXhxHvq7dBDh4HpbH29v4yE9JRadAVpndvzySN",
              ],
            },
          },
          transport: {
            //Probably want a hybrid where some are wss and some can be ip4/ws (like localhost)
            [WS.prototype[Symbol.toStringTag]]: {
              filter: websocketMaFilters.all,
            },
          },
        },
      },
      options
    )
  );

  const bitswap = new Bitswap(host, repo.blocks);
  const preloader = new Preloader({
    addresses: [
      "/dns4/node0.preload.ipfs.io/https",
      "/dns4/node1.preload.ipfs.io/https",
      "/dns4/node2.preload.ipfs.io/https",
      "/dns4/node3.preload.ipfs.io/https",
    ],
  });

  await host.start();
  await bitswap.start();

  await repo.init({});
  await repo.open();

  const blockService = new BlockService(repo);
  blockService.setExchange(bitswap);

  const ipld = new Ipld({ blockService });

  await new Promise((res) => setTimeout(res, 1000));

  const originalDial = host.dial.bind(host);
  const originalDialProtocol = host.dialProtocol.bind(host);

  //TODO God willing: try to use dnsaddr cache first? Possibly randomize per call, God willing?
  host.addresses._resolved = {};
  const resolveAddr = async function (addr, forceDns) {
    if (!forceDns && Multiaddr.isMultiaddr(addr)) {
      return addr;
    }

    const parts =
      typeof addr === "string" ? addr.split("/").filter(Boolean) : [];

    //Only override /dnsaddr/<domain-name>
    const hasPrefix = parts.length === 2 && parts[0] === "dnsaddr";
    if (forceDns || hasPrefix) {
      const resolveAddr = hasPrefix ? addr : "/dnsaddr/" + addr;
      const multiaddrs =
        host.addresses._resolved[addr] ||
        (await dnsaddrResolver(new Multiaddr(resolveAddr)));

      if (multiaddrs && multiaddrs.length) {
        host.addresses._resolved[addr] = multiaddrs;
      }

      return multiaddrs[0];
    }

    return addr;
  };

  //TODO God willing: dial /dnsaddr/sahidmiller.com rather than /dnsaddr/sahidmiller.com/p2p/Qm123
  // store the resolve results, God willing, for verification later?
  host.dial = async function (addr, options = {}) {
    const { forceDns = false } = options;
    return await originalDial(await resolveAddr(addr, forceDns), options);
  };

  host.dialProtocol = async function (addr, protocols, options = {}) {
    const { forceDns = false } = options;
    return await originalDialProtocol(
      await resolveAddr(addr, forceDns),
      protocols,
      options
    );
  };

  return {
    get: async (cid, options = {}) => {
      preloader.preload(cid);
      return await ipld.get(cid, options);
    },
    put: async (
      node,
      { format = DAG_PB, hashAlg, cidVersion, signal } = {}
    ) => {
      const cid = await ipld.put(node, format, {
        hashAlg,
        cidVersion,
        signal: signal,
      });

      preloader.preload(cid);
      return cid;
    },
    libp2p: host,
  };
}
