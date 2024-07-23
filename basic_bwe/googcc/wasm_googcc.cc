#include <emscripten/bind.h>
#include <cstdint>
#include <vector>

#include "third_party/webrtc/files/stable/webrtc/api/environment/environment_factory.h"
#include "third_party/webrtc/files/stable/webrtc/api/units/timestamp.h"
#include "third_party/webrtc/files/stable/webrtc/rtc_base/logging.h"
#include "third_party/webrtc/files/stable/webrtc/modules/congestion_controller/goog_cc/goog_cc_network_control.h"

namespace {
struct TargetTransferRate {
  public:
  long at_time = 0;
  long target_rate_bps = 0;
  long stable_target_rate_bps = 0;
  long bandwidth_estimate_bps = 0;
  long rtt_millis = 0;
};

class PacketResult {
public:
  PacketResult(long received_time_millis, long sequence_number, long sent_time_millis, long sent_size) :
      received_time_millis_(received_time_millis),
      sequence_number_(sequence_number),
      sent_time_millis_(sent_time_millis),
      sent_size_(sent_size) {}

  long received_time_millis_;
  long sequence_number_;
  long sent_time_millis_;
  long sent_size_;
};

class GoogCCWrapper {
 public:
  GoogCCWrapper() {
    webrtc::NetworkControllerConfig nc_config(webrtc::EnvironmentFactory().Create());
    nc_config.constraints.at_time = webrtc::Timestamp::Seconds(0);
    nc_config.constraints.min_data_rate = webrtc::DataRate::KilobitsPerSec(37);
    nc_config.constraints.starting_rate = webrtc::DataRate::KilobitsPerSec(1000);

    nc_config.stream_based_config.max_total_allocated_bitrate = webrtc::DataRate::KilobitsPerSec(100000);

    webrtc::GoogCcConfig goog_cc_config;
    goog_cc_config.feedback_only = true;

    goog_cc_ = new webrtc::GoogCcNetworkController(nc_config, std::move(goog_cc_config));
    RTC_LOG(LS_ERROR) << "Created GoogCC network controller instance";
  }

  TargetTransferRate OnSentPacket(long time_millis, long size, long sequence_number) {
    webrtc::SentPacket sent_packet;
    sent_packet.send_time = webrtc::Timestamp::Millis(time_millis);
    sent_packet.size = webrtc::DataSize::Bytes(size);
    sent_packet.sequence_number = sequence_number;
    webrtc::NetworkControlUpdate update = goog_cc_->OnSentPacket(sent_packet);
    
    TargetTransferRate result;
    if (update.target_rate) {
      result.target_rate_bps = update.target_rate->target_rate.bps_or(-1);
      result.stable_target_rate_bps = update.target_rate->stable_target_rate.bps_or(-1);
      result.bandwidth_estimate_bps = update.target_rate->network_estimate.bandwidth.bps_or(-1);
      result.rtt_millis = update.target_rate->network_estimate.round_trip_time.ms_or(-1);
    }
    return result;
  }

  TargetTransferRate OnTransportPacketsFeedback(long time_millis, std::vector<PacketResult> packet_results) {
    webrtc::TransportPacketsFeedback feedback;
    feedback.feedback_time = webrtc::Timestamp::Millis(time_millis);
    std::vector<webrtc::PacketResult> packet_results_webrtc;
    packet_results_webrtc.reserve(packet_results.size());
    for (const auto& packet_result : packet_results) {
      webrtc::PacketResult packet_result_webrtc;
      packet_result_webrtc.receive_time = packet_result.received_time_millis_ == 0 ? webrtc::Timestamp::PlusInfinity() : webrtc::Timestamp::Millis(packet_result.received_time_millis_);
      webrtc::SentPacket sent_packet;
      sent_packet.sequence_number = packet_result.sequence_number_;
      sent_packet.send_time = webrtc::Timestamp::Millis(packet_result.sent_time_millis_);
      sent_packet.size = webrtc::DataSize::Bytes(packet_result.sent_size_);
      packet_result_webrtc.sent_packet = sent_packet;
      packet_results_webrtc.push_back(packet_result_webrtc);
    }
    feedback.packet_feedbacks = packet_results_webrtc;
    webrtc::NetworkControlUpdate update = goog_cc_->OnTransportPacketsFeedback(feedback);
    TargetTransferRate result;
    if (update.target_rate) {
      result.target_rate_bps = update.target_rate->target_rate.bps_or(-1);
      result.stable_target_rate_bps = update.target_rate->stable_target_rate.bps_or(-1);
      result.bandwidth_estimate_bps = update.target_rate->network_estimate.bandwidth.bps_or(-1);
      result.rtt_millis = update.target_rate->network_estimate.round_trip_time.ms_or(-1);
    }
    return result;
  }

  TargetTransferRate OnProcessInterval(long time_millis) {
    webrtc::ProcessInterval process_interval;
    process_interval.at_time = webrtc::Timestamp::Millis(time_millis);
    webrtc::NetworkControlUpdate update = goog_cc_->OnProcessInterval(process_interval);
    TargetTransferRate result;
    if (update.target_rate) {
      result.target_rate_bps = update.target_rate->target_rate.bps_or(-1);
      result.stable_target_rate_bps = update.target_rate->stable_target_rate.bps_or(-1);
      result.bandwidth_estimate_bps = update.target_rate->network_estimate.bandwidth.bps_or(-1);
      result.rtt_millis = update.target_rate->network_estimate.round_trip_time.ms_or(-1);
    }
    return result;
  }

 private:
  webrtc::GoogCcNetworkController* goog_cc_;
};
}  // namespace

EMSCRIPTEN_BINDINGS(googcc) {
  emscripten::register_vector<PacketResult>("PacketResultVector");
  emscripten::class_<PacketResult>("PacketResult")
      .constructor<long, long, long, long>();
  emscripten::value_object<TargetTransferRate>("TargetTransferRate")
      .field("at_time", &TargetTransferRate::at_time)
      .field("target_rate_bps", &TargetTransferRate::target_rate_bps)
      .field("stable_target_rate_bps", &TargetTransferRate::stable_target_rate_bps)
      .field("bandwidth_estimate_bps", &TargetTransferRate::bandwidth_estimate_bps)
      .field("rtt_millis", &TargetTransferRate::rtt_millis);

  emscripten::class_<GoogCCWrapper>("GoogCCWrapper")
      .constructor<>()
      .function("onSentPacket", &GoogCCWrapper::OnSentPacket)
      .function("onTransportPacketsFeedback", &GoogCCWrapper::OnTransportPacketsFeedback)
      .function("onProcessInterval", &GoogCCWrapper::OnProcessInterval);
}