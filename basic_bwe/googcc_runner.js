let worker = new Worker("worker.js");

worker.postMessage("hi");
console.log(worker);
window.worker = worker;

worker.onmessage = (message) => {
  newTargetRate = message.data;
  targetRateElement.innerHTML = `Target rate returned by wasm congestion controller: ${newTargetRate.target_rate_bps}bps, estimated RTT: ${newTargetRate.rtt_millis}ms`;//,<br\> Packets waiting for feedback: ${sentPacketMap.size}`;
};

async function runGoogcc() {
  if (!pc1 || !pc1.rtpTransport) {
    console.log("NO PC1 or transport");
    return;
  }
  pc1.rtpTransport.createProcessor(worker);
}


if (!('rtpTransport' in RTCPeerConnection.prototype)) {
  document.getElementById("notEnabledWarning").style.display = 'inline';
  document.getElementById("startButton").disabled = true;
}