/**
 * Ultra-Fast Message Queue v3 - PRIORITY EDITION
 * - Fire-and-forget approach with PRIORITY LANES
 * - Owner commands = INSTANT (skip queue)
 * - Group messages = HIGH priority
 * - Private messages = NORMAL priority
 * - Built-in command profiling for optimization
 * - Designed for WhatsApp Bot performance
 */

import colors from 'colors';

const timestamp = () => {
    return new Intl.DateTimeFormat('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Asia/Jakarta',
    }).format(new Date());
};

// Priority levels
const PRIORITY = {
    INSTANT: 0,   // Owner commands - skip queue entirely
    HIGH: 1,      // Group messages
    NORMAL: 2,    // Private messages  
    LOW: 3,       // Bulk operations
};

// Warna untuk logging
const colors_map = {
    QUEUE: 'cyan',
    SUCCESS: 'green',
    WARNING: 'yellow',
    ERROR: 'red',
    SLOW: 'magenta',
    OWNER: 'blue'
};

export default class ConcurrentQueue {
    constructor(options = {}) {
        this.activeCount = 0;
        this.processedIds = new Set();
        this.stats = {
            total: 0,
            success: 0,
            errors: 0,
            duplicates: 0,
            timeouts: 0,
            byPriority: { 0: 0, 1: 0, 2: 0, 3: 0 },
        };

        // Command performance tracking
        this.commandTimes = new Map();

        // Priority queues (untuk ketika kita di capacity)
        this.queues = {
            [PRIORITY.HIGH]: [],
            [PRIORITY.NORMAL]: [],
            [PRIORITY.LOW]: [],
        };

        // Config yang sudah dioptimasi
        this.config = {
            enabled: options.enabled !== false,
            maxConcurrent: options.maxConcurrent || 100, // Optimized dari 50 ke 100
            timeout: options.timeout || 20000, // Reduced dari 25s ke 20s
            dedupWindow: options.dedupWindow || 1500, // Reduced dari 2s ke 1.5s
            logEnabled: options.logEnabled ?? false,
        };

        // Owner numbers (akan diisi saat pertama kali)
        this.ownerNumbers = [];

        // Clear message IDs yang sudah lama (aggressive cleanup)
        setInterval(() => {
            this.processedIds.clear();
        }, 20000);
    }

    /**
     * Helper untuk logging dengan warna
     */
    log(color, message) {
        // Disabled logging
    }

    /**
     * Set owner numbers untuk priority detection
     */
    setOwners(owners) {
        this.ownerNumbers = owners || [];
    }

    /**
     * Calculate priority berdasarkan message context
     */
    calculatePriority(message) {
        const sender = message.key?.participant || message.key?.remoteJid || '';
        const senderNumber = sender.split('@')[0];
        const isGroup = message.key?.remoteJid?.endsWith('@g.us');

        // Owner = INSTANT (skip queue)
        if (this.ownerNumbers.some(o => senderNumber.includes(o) || o.includes(senderNumber))) {
            return PRIORITY.INSTANT;
        }

        // Group message = HIGH priority
        if (isGroup) {
            return PRIORITY.HIGH;
        }

        // Private message = NORMAL
        return PRIORITY.NORMAL;
    }

    /**
     * Enqueue message dengan priority
     */
    enqueue(message, handler, forcePriority = null) {
        if (!this.config.enabled) {
            this.fireAndForget(message, handler, PRIORITY.NORMAL);
            return;
        }

        const messageId = message.key?.id;
        const messageContent = message.message;
        const hasContent = messageContent && Object.keys(messageContent).length > 0;

        // Quick dedup check
        if (messageId && hasContent && this.processedIds.has(messageId)) {
            this.stats.duplicates++;
            return;
        }

        if (messageId && hasContent) {
            this.processedIds.add(messageId);
            setTimeout(() => this.processedIds.delete(messageId), this.config.dedupWindow);
        }

        // Skip empty messages (except stubs)
        const isStubType = message.messageStubType != null;
        if (!hasContent && !isStubType) {
            return;
        }

        // Calculate priority
        const priority = forcePriority ?? this.calculatePriority(message);
        this.stats.byPriority[priority]++;

        // INSTANT priority = langsung, tanpa capacity check
        if (priority === PRIORITY.INSTANT) {
            this.fireAndForget(message, handler, priority);
            return;
        }

        // Check capacity
        if (this.activeCount < this.config.maxConcurrent) {
            this.fireAndForget(message, handler, priority);
        } else {
            // Queue by priority (HIGH diproses pertama)
            if (priority === PRIORITY.HIGH) {
                this.queues[PRIORITY.HIGH].push({ message, handler, priority });
            } else {
                this.queues[PRIORITY.NORMAL].push({ message, handler, priority });
            }
        }
    }

    /**
     * Process queued messages ketika capacity free up
     */
    processQueue() {
        if (this.activeCount >= this.config.maxConcurrent) return;

        // Process HIGH priority first
        if (this.queues[PRIORITY.HIGH].length > 0) {
            const item = this.queues[PRIORITY.HIGH].shift();
            this.fireAndForget(item.message, item.handler, item.priority);
            return;
        }

        // Then NORMAL
        if (this.queues[PRIORITY.NORMAL].length > 0) {
            const item = this.queues[PRIORITY.NORMAL].shift();
            this.fireAndForget(item.message, item.handler, item.priority);
            return;
        }

        // Then LOW
        if (this.queues[PRIORITY.LOW].length > 0) {
            const item = this.queues[PRIORITY.LOW].shift();
            this.fireAndForget(item.message, item.handler, item.priority);
        }
    }

    /**
     * Process message dengan timeout - fire and forget
     */
    async fireAndForget(message, handler, priority = PRIORITY.NORMAL) {
        this.activeCount++;
        this.stats.total++;
        const startTime = Date.now();
        const msgId = message.key?.id?.substring(0, 8) || 'unknown';

        // Extract command name untuk profiling
        const msgContent = message.message;
        const textContent = msgContent?.conversation ||
            msgContent?.extendedTextMessage?.text ||
            msgContent?.imageMessage?.caption || '';
        const cmdMatch = textContent.match(/^[.!#](\w+)/);
        const cmdName = cmdMatch ? cmdMatch[1] : 'other';

        const priorityEmoji = priority === 0 ? '👑' : priority === 1 ? '🔵' : '⚪';

        try {
            await Promise.race([
                handler(message),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('TIMEOUT')), this.config.timeout)
                )
            ]);

            this.stats.success++;
            const execTime = Date.now() - startTime;

            // Track command execution time
            if (cmdName !== 'other') {
                if (!this.commandTimes.has(cmdName)) {
                    this.commandTimes.set(cmdName, { total: 0, count: 0, max: 0 });
                }
                const cmdStats = this.commandTimes.get(cmdName);
                cmdStats.total += execTime;
                cmdStats.count++;
                cmdStats.max = Math.max(cmdStats.max, execTime);
            }

        } catch (error) {
            if (error.message === 'TIMEOUT') {
                this.stats.timeouts++;
            } else {
                this.stats.errors++;
            }
        } finally {
            this.activeCount--;
            // Process next queued message
            this.processQueue();
        }
    }

    /**
     * Get slow commands report
     */
    getSlowCommands(threshold = 500) {
        const slow = [];
        for (const [cmd, stats] of this.commandTimes.entries()) {
            const avg = stats.total / stats.count;
            if (avg > threshold || stats.max > 1000) {
                slow.push({
                    cmd,
                    avgTime: Math.round(avg),
                    maxTime: stats.max,
                    count: stats.count,
                });
            }
        }
        return slow.sort((a, b) => b.avgTime - a.avgTime);
    }

    /**
     * Get queue status
     */
    getStatus() {
        return {
            active: this.activeCount,
            queued: {
                high: this.queues[PRIORITY.HIGH].length,
                normal: this.queues[PRIORITY.NORMAL].length,
                low: this.queues[PRIORITY.LOW].length,
            },
            ...this.stats,
            enabled: this.config.enabled,
            slowCommands: this.getSlowCommands(),
        };
    }

    /**
     * Clear everything
     */
    clear() {
        this.processedIds.clear();
        this.queues[PRIORITY.HIGH] = [];
        this.queues[PRIORITY.NORMAL] = [];
        this.queues[PRIORITY.LOW] = [];
    }

    // Compatibility methods
    clearOnStartup() { this.clear(); return 0; }
    setEnabled(enabled) { this.config.enabled = enabled; }
    getActiveWorkers() { return []; }
    saveQueue() { }
    recoverQueue() { }
}

export { PRIORITY };
