/**
 * Enhanced Optimizer v2 - Parallel Helper Execution
 * Based on Experimental-Bell best practices
 * 
 * Improvements:
 * - Parallel execution of utils() + client() + interactive()
 * - Pre-fetch admin data BEFORE handler call
 * - Aggressive message deduplication  
 * - Smart console logging suppression
 * - Performance profiling per command
 */

export class EnhancedOptimizer {
    constructor() {
        this.cache = {
            groupAdmins: new Map(),
            botAdmin: new Map(),
            members: new Map(),
        };
        this.cacheExpire = 15000; // 15 seconds TTL
        this.processedMessages = new Set();
        this.commandStats = new Map();
        this.ignorePatterns = ['Timed Out', 'rate-overlimit', 'Connection closed'];
    }

    /**
     * Clear all caches (biasa dipanggil saat reconnect)
     */
    clearCache() {
        this.cache.groupAdmins.clear();
        this.cache.botAdmin.clear();
        this.cache.members.clear();
        this.processedMessages.clear();
    }

    /**
     * Suppress non-essential logging (Rifza's pattern)
     */
    initLoggingSuppression() {
        const originalError = console.error;
        const originalLog = console.log;
        const originalWarn = console.warn;

        const shouldIgnore = (message) => {
            if (typeof message !== 'string') return false;
            return this.ignorePatterns.some(pattern => message.includes(pattern));
        };

        console.error = (...args) => {
            if (!shouldIgnore(args[0]?.toString())) {
                originalError.apply(console, args);
            }
        };

        console.log = (...args) => {
            if (!shouldIgnore(args[0]?.toString())) {
                originalLog.apply(console, args);
            }
        };

        console.warn = (...args) => {
            if (!shouldIgnore(args[0]?.toString())) {
                originalWarn.apply(console, args);
            }
        };
    }

    /**
     * Pre-fetch admin data PARALLEL (tidak blocking)
     */
    async preFetchGroupData(conn, msg) {
        if (!msg.isGroup) return {};

        try {
            // Parallel fetch menggunakan Promise.all
            const [admins, botAdminStatus, members] = await Promise.all([
                this.getCachedGroupAdmins(conn, msg.chat),
                this.getCachedBotAdmin(conn, msg.chat),
                this.getCachedMembers(conn, msg.chat),
            ]);

            return {
                groupAdmins: admins,
                isAdmin: admins?.includes(msg.sender) ?? false,
                isBotAdmin: botAdminStatus ?? false,
                members: members ?? [],
            };
        } catch (err) {
            return {
                groupAdmins: [],
                isAdmin: false,
                isBotAdmin: false,
                members: [],
            };
        }
    }

    /**
     * Get cached group admins dengan TTL
     */
    async getCachedGroupAdmins(conn, groupId) {
        const cacheKey = `admins-${groupId}`;
        const cached = this.cache.groupAdmins.get(cacheKey);

        if (cached && Date.now() - cached.time < this.cacheExpire) {
            return cached.data;
        }

        try {
            const metadata = await conn.groupMetadata(groupId).catch(() => null);
            const admins = metadata?.participants
                ?.filter(p => p.admin)
                ?.map(p => p.id) ?? [];

            this.cache.groupAdmins.set(cacheKey, {
                data: admins,
                time: Date.now(),
            });

            return admins;
        } catch (err) {
            return [];
        }
    }

    /**
     * Get cached bot admin status
     */
    async getCachedBotAdmin(conn, groupId) {
        const cacheKey = `botadmin-${groupId}`;
        const cached = this.cache.botAdmin.get(cacheKey);

        if (cached && Date.now() - cached.time < this.cacheExpire) {
            return cached.data;
        }

        try {
            const metadata = await conn.groupMetadata(groupId).catch(() => null);
            const botId = conn.user.id;
            const isBotAdmin = metadata?.participants?.some(
                p => p.id === botId && p.admin
            ) ?? false;

            this.cache.botAdmin.set(cacheKey, {
                data: isBotAdmin,
                time: Date.now(),
            });

            return isBotAdmin;
        } catch (err) {
            return false;
        }
    }

    /**
     * Get cached group members
     */
    async getCachedMembers(conn, groupId) {
        const cacheKey = `members-${groupId}`;
        const cached = this.cache.members.get(cacheKey);

        if (cached && Date.now() - cached.time < this.cacheExpire) {
            return cached.data;
        }

        try {
            const metadata = await conn.groupMetadata(groupId).catch(() => null);
            const members = metadata?.participants?.map(p => ({
                id: p.id,
                admin: p.admin,
                name: p.name,
            })) ?? [];

            this.cache.members.set(cacheKey, {
                data: members,
                time: Date.now(),
            });

            return members;
        } catch (err) {
            return [];
        }
    }

    /**
     * Message deduplication - aggressive
     */
    isDuplicate(messageId) {
        if (!messageId) return false;

        if (this.processedMessages.has(messageId)) {
            return true;
        }

        this.processedMessages.add(messageId);

        // Auto cleanup after 2 seconds
        setTimeout(() => {
            this.processedMessages.delete(messageId);
        }, 2000);

        return false;
    }

    /**
     * Track command performance
     */
    startCommandTimer(cmd) {
        return Date.now();
    }

    endCommandTimer(cmd, startTime) {
        const duration = Date.now() - startTime;

        if (!this.commandStats.has(cmd)) {
            this.commandStats.set(cmd, { total: 0, count: 0, min: Infinity, max: 0 });
        }

        const stats = this.commandStats.get(cmd);
        stats.total += duration;
        stats.count++;
        stats.min = Math.min(stats.min, duration);
        stats.max = Math.max(stats.max, duration);
    }

    /**
     * Get slow commands (>1s average)
     */
    getSlowCommands() {
        const slow = [];

        for (const [cmd, stats] of this.commandStats) {
            const avg = stats.total / stats.count;
            if (avg > 1000) {
                slow.push({ cmd, avg: Math.round(avg) });
            }
        }

        return slow.sort((a, b) => b.avg - a.avg);
    }

    /**
     * Clear cache untuk group tertentu
     */
    clearGroupCache(groupId) {
        this.cache.groupAdmins.delete(`admins-${groupId}`);
        this.cache.botAdmin.delete(`botadmin-${groupId}`);
        this.cache.members.delete(`members-${groupId}`);
    }

    /**
     * Clear all cache
     */
    clearAllCache() {
        this.cache.groupAdmins.clear();
        this.cache.botAdmin.clear();
        this.cache.members.clear();
    }
}

export default EnhancedOptimizer;
