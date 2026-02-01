/**
 * Queue Integration Module v2
 * Mengintegrasikan ConcurrentQueue + EnhancedOptimizer untuk performa maksimal
 * 
 * Improvements:
 * - Parallel helper execution (utils, client, interactive)
 * - Pre-fetch admin data sebelum handler
 * - Aggressive message deduplication
 * - Smart console logging suppression
 * 
 * PENGGUNAAN:
 * import { QueueManager } from './queue/QueueIntegration.js';
 * 
 * // Di main.js atau handler.js
 * const queueManager = new QueueManager(ownerNumbers, logEnabled);
 * 
 * // Di message event
 * queueManager.enqueueMessage(conn, msg, chatUpdate);
 */

import ConcurrentQueue, { PRIORITY } from './ConcurrentQueue.js';
import { AdminDetector, GroupUtils } from './AdminDetector.js';
import EnhancedOptimizer from './EnhancedOptimizer.js';
import colors from 'colors';

export class QueueManager {
    constructor(ownerNumbers = [], logEnabled = false) {
        // Initialize queue
        this.queue = new ConcurrentQueue({
            enabled: true,
            maxConcurrent: 100,
            timeout: 20000,
            dedupWindow: 1500,
            logEnabled: logEnabled
        });

        // Set owner numbers
        this.queue.setOwners(ownerNumbers);

        // Initialize optimizer
        this.optimizer = new EnhancedOptimizer();
        this.optimizer.initLoggingSuppression();

        // Store reference untuk admin detector
        this.adminDetector = null;
        this.logEnabled = logEnabled;
    }

    /**
     * Initialize admin detector dengan Exp instance
     * @param {Object} Exp - WhatsApp connection instance
     * @param {Object} func - Function utilities
     */
    initializeAdminDetector(Exp, func) {
        this.adminDetector = new AdminDetector(Exp, func);
    }

    /**
     * Enqueue message dengan PARALLEL pre-fetch admin data
     * @param {Object} conn - Connection instance
     * @param {Object} msg - Message object
     * @param {Function} handlerFunction - Message handler
     */
    async enqueueWithOptimization(conn, msg, handlerFunction) {
        // Check duplicate messages
        if (this.optimizer.isDuplicate(msg.key?.id)) {
            return;
        }

        // Pre-fetch admin data PARALLEL (tidak blocking)
        const groupData = msg.isGroup 
            ? await this.optimizer.preFetchGroupData(conn, msg)
            : {};

        // Attach pre-fetched data ke message
        Object.assign(msg, groupData);

        // Enqueue handler dengan pre-fetched data
        this.enqueue(handlerFunction, msg);
    }

    /**
     * Enqueue message dengan priority handling
     * @param {Function} handlerFunction - Async handler function
     * @param {Object} message - Message object
     * @param {number} forcePriority - Force priority (optional)
     */
    enqueue(handlerFunction, message, forcePriority = null) {
        if (!handlerFunction || typeof handlerFunction !== 'function') {
            return;
        }

        this.queue.enqueue(message, handlerFunction, forcePriority);
    }

    /**
     * Get queue status
     */
    getStatus() {
        return this.queue.getStatus();
    }

    /**
     * Get slow commands report
     */
    getSlowCommands(threshold = 500) {
        return this.queue.getSlowCommands(threshold);
    }

    /**
     * Clear queue
     */
    clear() {
        this.queue.clear();
    }

    /**
     * Get admin info untuk group
     */
    async getGroupAdmins(groupId) {
        if (!this.adminDetector) {
            return [];
        }
        return await this.adminDetector.getGroupAdmins(groupId);
    }

    /**
     * Check apakah user adalah admin (dengan auto-retry jika tidak ketemu)
     */
    async isUserAdmin(groupId, userId) {
        if (!this.adminDetector) return false;
        return await this.adminDetector.isAdminWithRetry(groupId, userId);
    }

    /**
     * Force clear all caches (biasa dipanggil saat reconnect)
     */
    clearCaches() {
        if (this.adminDetector) {
            this.adminDetector.clearAllCaches();
        }
        this.optimizer.clearCache();
    }

    /**
     * Handle reconnection event
     */
    onReconnect(conn) {
        // Clear all caches saat reconnect
        this.clearCaches();
        
        if (this.logEnabled) {
            console.log(colors.yellow('[QUEUE] Reconnected - cleared caches'));
        }
        
        // Re-initialize admin detector dengan conn baru
        if (this.adminDetector) {
            this.adminDetector.Exp = conn;
        }
    }

    /**
     * Get group metadata dengan force refresh option
     */
    async getGroupMetadata(groupId, forceRefresh = false) {
        if (!this.adminDetector) return null;
        return await this.adminDetector.getGroupMetadata(groupId, forceRefresh);
    }

    /**
     * Check apakah user adalah admin
     */
    async isAdmin(groupId, userId) {
        if (!this.adminDetector) return false;
        return await this.adminDetector.isAdmin(groupId, userId);
    }

    /**
     * Check apakah bot adalah admin
     */
    async isBotAdmin(groupId) {
        if (!this.adminDetector) return false;
        return await this.adminDetector.isBotAdmin(groupId);
    }

    /**
     * Get group members dengan role
     */
    async getGroupMembers(groupId) {
        if (!this.adminDetector) return { admins: [], members: [] };
        return await this.adminDetector.getGroupMembers(groupId);
    }

    /**
     * Get group status
     */
    async getGroupStatus(groupId) {
        if (!this.adminDetector) return null;
        return await this.adminDetector.getGroupStatus(groupId);
    }

    /**
     * Clear cache untuk group (force refresh)
     */
    clearGroupCache(groupId = null) {
        if (!this.adminDetector) return;
        this.adminDetector.clearCache(groupId);
    }
}

/**
 * Factory function untuk membuat queue manager dengan default config
 */
export function createQueueManager(ownerNumbers = [], logEnabled = false) {
    return new QueueManager(ownerNumbers, logEnabled);
}

/**
 * Export utilities
 */
export { GroupUtils, AdminDetector, PRIORITY };
