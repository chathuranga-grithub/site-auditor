// WebRTC (video calls, chat widgets, some trackers) can send UDP straight from this computer,
// around the proxy, and show a site our real IP. Every browser that goes through the proxy uses both.

/**
 * Launch flags: no WebRTC traffic outside the proxy. `--force-webrtc-ip-handling-policy` alone
 * has no effect in Edge or Chrome (tested: the real IP still showed); the second flag is the one
 * that works. Both are kept.
 */
export const NO_WEBRTC_ARGS = [
  "--webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
];

/** Run in every page and frame before the site's own scripts: removes WebRTC altogether. */
export const NO_WEBRTC_SCRIPT = `for (const k of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCSessionDescription", "RTCIceCandidate"]) {
  try { delete window[k]; } catch {}
}`;
