let worker = new Worker("worker.js");
window.worker = worker;

worker.onmessage = (message) => {
  newTargetRate = message.data;
  targetRateElement.innerHTML = `Target rate returned by wasm congestion controller: ${newTargetRate.target_rate_bps}bps, estimated RTT: ${newTargetRate.rtt_millis}ms`;//,<br\> Packets waiting for feedback: ${sentPacketMap.size}`;
};

async function startGoogcc(pc) {
  console.log("Creating RTCRtpTransportProcessor on worker");
  pc.rtpTransport.createProcessor(worker);
}

if (!('rtpTransport' in RTCPeerConnection.prototype && 'createProcessor' in RTCRtpTransport.prototype)) {
  document.getElementById("notEnabledWarning").style.display = 'inline';
  document.getElementById("startButton").disabled = true;
}
