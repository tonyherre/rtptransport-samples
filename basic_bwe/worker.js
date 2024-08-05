importScripts("googcc/build/googcc.js");

let processor;

onrtcrtptransportprocessor = (m) => {
  console.log("Received onrtcrtptransportprocessor, ", m);
  runGoogcc(m.processor);
};

let googcc;
let module;

async function runGoogcc(processor) {
  const wasmResponse = await fetch('googcc/build/googcc.wasm');

  let data = await wasmResponse.arrayBuffer();
  module = await loadGoogccWasm({wasm: data});
  googcc = new module.GoogCCWrapper();

  // Give googCC a chance to ingest the initial config before it starts getting
  // packet reports, otherwise it gets confused by the timestamps jumping
  // backwards and crashes.
  googcc.onProcessInterval(0);

  runGoogccSentPackets(processor);
  runGoogccFeedback(processor);
  runGoogccProcessInterval();
}

const sentPacketMap = new Map();

// performance.now() + time_offset approximates now in the same clock as the
// RtpTransport sent/received feedback timestamps.
let time_offset = 0;
const maxPackets = 100;

async function runGoogccSentPackets(processor) {
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

async function runGoogccFeedback(processor) {
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
