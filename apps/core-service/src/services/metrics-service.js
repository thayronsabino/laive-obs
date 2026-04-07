class MetricsService {
  constructor() {
    this.startedAt = Date.now();
    this.counters = new Map();
    this.recentEvents = [];
    this.maxRecentEvents = 300;
  }

  increment(name, by = 1) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + by);
  }

  recordEvent(type, payload = {}) {
    this.recentEvents.unshift({
      type,
      payload,
      timestamp: new Date().toISOString()
    });
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents = this.recentEvents.slice(0, this.maxRecentEvents);
    }
  }

  getSnapshot() {
    const counters = {};
    this.counters.forEach((value, key) => {
      counters[key] = value;
    });

    return {
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      counters,
      recentEvents: [...this.recentEvents]
    };
  }
}

module.exports = {
  MetricsService
};
