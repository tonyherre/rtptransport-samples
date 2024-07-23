let googcc;
let module;
async function startgoogcc() {
  if (!('rtpTransport' in RTCPeerConnection.prototype)) {
    document.getElementById("notEnabledWarning").style.display = 'inline';
    document.getElementById("startButton").disabled = true;
    return;
  }

  const wasmResponse = await fetch('googcc/build/googcc.wasm');

  let data = await wasmResponse.arrayBuffer();
  module = await loadGoogccWasm({wasm: data});
  googcc = new module.GoogCCWrapper();
}

const sentPacketMap = new Map();

const maxPackets = 100;
async function runGoogcc() {
  let rtpTransport = pc1.rtpTransport;

  runGoogccSentPackets();
  runGoogccFeedback();
  runGoogccProcessInterval();
  runGoogccPacing();
}

// performance.now() + time_offset approximates now in the same clock as the
// RtpTransport sent/received feedback timestamps.
let time_offset = 0;

async function runGoogccSentPackets() {
  let rtpTransport = pc1.rtpTransport;

  while (true) {
    let sentPackets = rtpTransport.readSentRtp(maxPackets);
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


async function runGoogccFeedback() {
  let rtpTransport = pc1.rtpTransport;

  while (true) {
    let feedbackPackets = rtpTransport.readReceivedAcks(maxPackets);
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
      if (newTargetRate.target_rate_bps > 0) {
        targetRateElement.innerHTML = `Target rate returned by wasm congestion controller: ${newTargetRate.target_rate_bps}bps, estimated RTT: ${newTargetRate.rtt_millis}ms,<br\> Packets waiting for feedback: ${sentPacketMap.size}`;
      }
    });
    if (feedbackPackets.length < maxPackets) {
      // Wait for more feedback packets.
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

async function runGoogccProcessInterval() {
  let rtpTransport = pc1.rtpTransport;

  while (true) {
    let newTargetRate = googcc.onProcessInterval(performance.now() + time_offset);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Hey, ho, let's go!
startgoogcc();


async function runGoogccPacing() {
  sendStream = await pc1.getSenders()[0].replaceSendStreams();

  let packetBuffer = [];
  // Read packets into packetBuffer.
  (async () => {
    let seqNum = 0;
    while(true) {
      let packets = sendStream.readPacketizedRtp(1000);
      packets.forEach((packet) => {
        let buffer = new ArrayBuffer(5000);
        packet.copyPayloadTo(buffer);
        packetBuffer.push({
          sequenceNumber: seqNum++,
          marker:packet.marker,
          timestamp: packet.timestamp,
          payloadType: packet.payloadType,
          payload: new Uint8Array(buffer, 0, packet.payloadSize)
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })();

  // Send them with our desired pacing.
  while (true) {
    packetBuffer.forEach((packet) => {
      sendStream.sendRtp(packet, {});
    });
    packetBuffer = [];

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}