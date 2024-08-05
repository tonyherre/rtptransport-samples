importScripts("googcc/build/googcc.js");

let processor;

const maxPackets = 100;
console.log("onrtcrtptransportprocessor");

onrtcrtptransportprocessor = (m) => {
  console.log("onrtcrtptransportprocessor");
  processor = m.processor;

  if (processor) {
    runGoogcc();
  } else {
    console.log("Received message ", m);
  }
};

let googcc;
let module;

async function runGoogcc() {
  const wasmResponse = await fetch('googcc/build/googcc.wasm');

  let data = await wasmResponse.arrayBuffer();
  module = await loadGoogccWasm({wasm: data});
  googcc = new module.GoogCCWrapper();

  console.log("Starting running in worker with ", processor);
  runGoogccSentPackets();
  runGoogccFeedback();
  runGoogccProcessInterval();
}

const sentPacketMap = new Map();

// performance.now() + time_offset approximates now in the same clock as the
// RtpTransport sent/received feedback timestamps.
let time_offset = 0;

async function runGoogccSentPackets() {
  while (true) {
    let sentPackets = processor.readSentRtp(maxPackets);
    sentPackets.forEach(packet => {
      sentPacketMap.set(packet.ackId, packet);
      let newTargetRate = googcc.onSentPacket(packet.time, packet.size, packet.ackId);
      if (time_offset === 0) {
        time_offset = packet.time - performance.now();
      }
    });
    if (sentPackets.length < maxPackets) {
      // Wait for more packets to be sent.
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

let lastMessageTime = 0;

async function runGoogccFeedback() {
  while (true) {
    let feedbackPackets = processor.readReceivedAcks(maxPackets);
    feedbackPackets.forEach(packet => {
      const packetResults = new module.PacketResultVector();
      packet.acks().forEach(ack => {
        if (sentPacketMap.has(ack.ackId)) {
          let sentPacket = sentPacketMap.get(ack.ackId);
          sentPacketMap.delete(ack.ackId);
          packetResults.push_back(new module.PacketResult(ack.remoteReceiveTimestamp, ack.ackId, sentPacket.time, sentPacket.size));
        }
        if (ack.remoteReceiveTimestamp == 0) {
          console.log("ack.remoteReceiveTimestamp == 0");
        }
      });
      let newTargetRate = googcc.onTransportPacketsFeedback(packet.remoteSendTimestamp, packetResults);
      if (newTargetRate.target_rate_bps > 0 && (performance.now() - lastMessageTime > 1000)) {
        postMessage(newTargetRate);
        lastMessageTime = performance.now();
      }
    });
    if (feedbackPackets.length < maxPackets) {
      // Wait for more feedback packets.
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

async function runGoogccProcessInterval() {
  while (true) {
    let newTargetRate = googcc.onProcessInterval(performance.now() + time_offset);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
