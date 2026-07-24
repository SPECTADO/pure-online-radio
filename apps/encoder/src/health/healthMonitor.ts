/** Narrow view of MasterEncoder that healthMonitor needs, to avoid a circular import. */
export interface SupervisedHealth {
  isHealthy(): boolean;
}

/**
 * Tracks process uptime and the master encoder's supervisor health, feeding
 * statusPublisher's heartbeat. Deliberately tiny - this is not a general
 * metrics system, just the couple of numbers HeartbeatStatus needs today.
 */
export class HealthMonitor {
  private readonly startedAtNs = process.hrtime.bigint();

  constructor(private readonly masterEncoder: SupervisedHealth) {}

  uptimeSec(): number {
    const elapsedNs = process.hrtime.bigint() - this.startedAtNs;
    return Number(elapsedNs) / 1_000_000_000;
  }

  isMasterEncoderHealthy(): boolean {
    return this.masterEncoder.isHealthy();
  }
}
