/**
 * Canonical NATS subject namespace. Three namespaces, each with a single
 * publisher role enforced at the NATS auth layer (see infra/docker/nats/nats-server.conf):
 *
 *  - radio.encoder.cmd.*    published by: api        | subscribed by: encoder
 *  - radio.encoder.status.* published by: encoder     | subscribed by: api, control-panel (read-only)
 *  - radio.control.*        published by: api        | subscribed by: control-panel (read-only)
 *
 * The browser (control-panel) NATS-ws credential is subscribe-only across the
 * board — all commands go browser -> authenticated HTTP -> api -> NATS.
 */
export const NATS_SUBJECTS = {
  cmd: {
    advance: "radio.encoder.cmd.advance",
    setMode: "radio.encoder.cmd.setMode",
    jinglePlay: "radio.encoder.cmd.jingle.play",
    jingleStop: "radio.encoder.cmd.jingle.stop",
    liveStart: "radio.encoder.cmd.live.start",
    liveStop: "radio.encoder.cmd.live.stop",
    relayStart: "radio.encoder.cmd.relay.start",
    relayStop: "radio.encoder.cmd.relay.stop",
    relayCancel: "radio.encoder.cmd.relay.cancel",
  },
  encoderStatus: {
    heartbeat: "radio.encoder.status.heartbeat",
    nowPlaying: "radio.encoder.status.nowPlaying",
    queueAdvanced: "radio.encoder.status.queueAdvanced",
    jingleStarted: "radio.encoder.status.jingle.started",
    jingleEnded: "radio.encoder.status.jingle.ended",
    liveStarted: "radio.encoder.status.live.started",
    liveEnded: "radio.encoder.status.live.ended",
    relayStarted: "radio.encoder.status.relay.started",
    relayEnded: "radio.encoder.status.relay.ended",
    error: "radio.encoder.status.error",
    commandAck: "radio.encoder.status.commandAck",
  },
  control: {
    mode: "radio.control.mode",
    queueUpdated: "radio.control.queueUpdated",
    alert: "radio.control.alert",
  },
} as const;

/** Subscribe-all wildcards, handy for the api's single encoder-status subscriber and the browser client. */
export const NATS_WILDCARDS = {
  cmd: "radio.encoder.cmd.>",
  encoderStatus: "radio.encoder.status.>",
  control: "radio.control.>",
} as const;
