/**
 * Admin Detection & Group Management Module
 * Fungsi untuk mendeteksi admin, LID, dan manage grup dengan efisien
 * Terintegrasi dengan Experimental-Bell repository
 */

import fs from 'fs';
import path from 'path';

export class AdminDetector {
    constructor(Exp, func) {
        this.Exp = Exp;
        this.func = func;
        this.metadataCache = new Map();
        this.cacheTimeout = 15000; // 15 detik cache
        this.adminCache = new Map();
    }

    /**
     * Get group admins dengan caching
     * @param {string} groupId - JID dari grup
     * @returns {Array} - Array dari admin JID
     */
    async getGroupAdmins(groupId) {
        // Check cache
        if (this.adminCache.has(groupId)) {
            const cached = this.adminCache.get(groupId);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.admins;
            }
        }

        try {
            const metadata = await this.getGroupMetadata(groupId);
            const admins = metadata.participants
                .filter(p => p.admin !== null)
                .map(p => p.id);

            // Cache result
            this.adminCache.set(groupId, {
                admins,
                timestamp: Date.now()
            });

            return admins;
        } catch (error) {
            return [];
        }
    }

    /**
     * Check apakah user adalah admin di grup (dengan LID support)
     * @param {string} groupId - JID dari grup
     * @param {string} userId - JID dari user
     * @param {boolean} forceRefresh - Force refresh metadata
     * @returns {boolean}
     */
    async isAdmin(groupId, userId, forceRefresh = false) {
        try {
            const metadata = await this.getGroupMetadata(groupId, forceRefresh);
            const user = this.findParticipant(metadata.participants, userId);
            
            if (!user) return false;
            
            return user.admin === 'admin' || user.admin === 'superadmin' || 
                   user.isAdmin === true || user.isSuperAdmin === true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Find participant dari array dengan support LID dan multiple JID formats
     * @private
     */
    findParticipant(participants, userId) {
        if (!participants || !userId) return null;
        
        const normalizedId = this.normalizeJid(userId);
        
        return participants.find(p => {
            const pId = this.normalizeJid(p.id);
            const pLid = p.lid ? this.normalizeJid(p.lid) : null;
            const pJid = p.jid ? this.normalizeJid(p.jid) : null;
            
            return pId === normalizedId || pLid === normalizedId || pJid === normalizedId;
        });
    }

    /**
     * Normalize JID untuk consistent comparison
     * @private
     */
    normalizeJid(jid) {
        if (!jid) return '';
        return jid.split('@')[0];
    }

    /**
     * Check apakah user adalah admin di grup (with auto-refresh if not found)
     * @param {string} groupId - JID dari grup
     * @param {string} userId - JID dari user
     * @returns {boolean}
     */
    async isAdminWithRetry(groupId, userId) {
        // First check cached data
        let isAdmin = await this.isAdmin(groupId, userId, false);
        if (isAdmin) return true;
        
        // If not found in cache, try force refresh (user mungkin baru dipromote)
        isAdmin = await this.isAdmin(groupId, userId, true);
        return isAdmin;
    }

    /**
     * Check apakah bot adalah admin di grup
     * @param {string} groupId - JID dari grup
     * @returns {boolean}
     */
    async isBotAdmin(groupId) {
        return await this.isAdmin(groupId, this.Exp.user?.id || '');
    }

    /**
     * Clear all caches (biasa dipanggil saat reconnect)
     */
    clearAllCaches() {
        this.metadataCache.clear();
        this.adminCache.clear();
    }

    /**
     * Get group metadata dengan caching dan retry
     * @param {string} groupId - JID dari grup
     * @param {boolean} force - Force update cache
     * @returns {Object} - Group metadata
     */
    async getGroupMetadata(groupId, force = false) {
        // Check cache
        if (!force && this.metadataCache.has(groupId)) {
            const cached = this.metadataCache.get(groupId);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.metadata;
            }
        }

        try {
            let metadata;
            let attempts = 0;

            // Retry logic
            while (attempts < 2) {
                try {
                    metadata = await this.Exp.groupMetadata(groupId);
                    break;
                } catch (err) {
                    attempts++;
                    if (attempts >= 2) throw err;
                    // Wait sebelum retry
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            // Handle LID addressing mode (WhatsApp baru)
            if (metadata.addressingMode === 'lid') {
                metadata = await this.handleLIDMode(groupId, metadata);
            }

            // Cache result
            this.metadataCache.set(groupId, {
                metadata,
                timestamp: Date.now()
            });

            return metadata;
        } catch (error) {
            // Return cached data meski sudah expired
            const cached = this.metadataCache.get(groupId);
            if (cached) return cached.metadata;
            throw error;
        }
    }

    /**
     * Handle LID (Linked ID) addressing mode
     * @private
     */
    async handleLIDMode(groupId, metadata) {
        try {
            // Query untuk mendapatkan participant dengan LID
            const query = {
                tag: 'iq',
                attrs: {
                    type: 'get',
                    xmlns: 'w:g2',
                    to: groupId,
                },
                content: [{ tag: 'query', attrs: { request: 'interactive' } }],
            };

            const result = await this.Exp.query(query);
            
            // Parse participant data
            if (result && result.content) {
                const participants = [];
                for (const item of result.content) {
                    if (item.tag === 'group' && item.content) {
                        for (const participant of item.content) {
                            if (participant.tag === 'participant') {
                                participants.push({
                                    id: participant.attrs?.phone_number || participant.attrs?.jid,
                                    lid: participant.attrs?.lid,
                                    admin: participant.attrs?.type || null,
                                });
                            }
                        }
                    }
                }
                if (participants.length > 0) {
                    metadata.participants = participants;
                }
            }
        } catch (error) {
            // Ignore LID handling errors
        }
        return metadata;
    }

    /**
     * Get sender JID (dengan LID support)
     * @param {string} jid - Target JID
     * @param {Object} context - {cht, lid}
     * @returns {string} - Normalized JID
     */
    async getSender(jid, { cht = null, lid = false } = {}) {
        if (!jid) return jid;

        // Parse JID
        const jidParts = jid.split('@');
        if (!jidParts[1]) return jid;

        const [user, server] = jidParts;
        const isGroup = cht?.id?.endsWith('@g.us');

        if (!isGroup) return jid;

        try {
            const metadata = await this.getGroupMetadata(cht.id);
            let participant = metadata.participants.find(
                p => (p.id?.split('@')[0] === user || p.lid?.split('@')[0] === user)
            );

            if (!participant) return jid;

            // Return LID jika requested dan tersedia
            if (lid && participant.lid) return participant.lid;
            return participant.id || jid;
        } catch (error) {
            return jid;
        }
    }

    /**
     * Get all group members dengan role mereka
     * @param {string} groupId - JID dari grup
     * @returns {Object} - {admins, members, superadmins}
     */
    async getGroupMembers(groupId) {
        try {
            const metadata = await this.getGroupMetadata(groupId);
            const members = {
                admins: [],
                superadmins: [],
                members: [],
                allIds: []
            };

            for (const participant of metadata.participants) {
                members.allIds.push(participant.id);
                
                if (participant.admin === 'superadmin') {
                    members.superadmins.push(participant.id);
                } else if (participant.admin === 'admin') {
                    members.admins.push(participant.id);
                } else {
                    members.members.push(participant.id);
                }
            }

            return members;
        } catch (error) {
            return { admins: [], superadmins: [], members: [], allIds: [] };
        }
    }

    /**
     * Detect status grup (announcement, restricted, dll)
     * @param {string} groupId - JID dari grup
     * @returns {Object} - Status object
     */
    async getGroupStatus(groupId) {
        try {
            const metadata = await this.getGroupMetadata(groupId);
            return {
                name: metadata.subject,
                owner: metadata.owner,
                created: metadata.creation * 1000,
                description: metadata.desc,
                isCommunity: metadata.isCommunity || false,
                isAnnouncement: metadata.announce || false,
                isRestricted: metadata.restrict || false,
                joinApprovalMode: metadata.joinApprovalMode || false,
                ephemeralDuration: metadata.ephemeralDuration || 0,
                size: metadata.participants?.length || 0,
                addressingMode: metadata.addressingMode || 'normal',
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Check apakah group memiliki approval mode
     * @param {string} groupId - JID dari grup
     * @returns {boolean}
     */
    async hasApprovalMode(groupId) {
        const status = await this.getGroupStatus(groupId);
        return status?.joinApprovalMode || false;
    }

    /**
     * Check apakah group adalah announcement only
     * @param {string} groupId - JID dari grup
     * @returns {boolean}
     */
    async isAnnouncementOnly(groupId) {
        const status = await this.getGroupStatus(groupId);
        return status?.isAnnouncement || false;
    }

    /**
     * Clear cache untuk force refresh
     * @param {string} groupId - Optional, jika tidak ada clear semua
     */
    clearCache(groupId = null) {
        if (groupId) {
            this.metadataCache.delete(groupId);
            this.adminCache.delete(groupId);
        } else {
            this.metadataCache.clear();
            this.adminCache.clear();
        }
    }

    /**
     * Get cache stats
     * @returns {Object}
     */
    getCacheStats() {
        return {
            metadataCached: this.metadataCache.size,
            adminCached: this.adminCache.size,
            cacheTimeout: this.cacheTimeout,
        };
    }
}

/**
 * Group utility functions
 */
export const GroupUtils = {
    /**
     * Promote user to admin
     */
    async promoteAdmin(Exp, groupId, userIds) {
        try {
            await Exp.groupParticipantsUpdate(groupId, userIds, 'promote');
            return true;
        } catch (error) {
            return false;
        }
    },

    /**
     * Demote user from admin
     */
    async demoteAdmin(Exp, groupId, userIds) {
        try {
            await Exp.groupParticipantsUpdate(groupId, userIds, 'demote');
            return true;
        } catch (error) {
            return false;
        }
    },

    /**
     * Remove member dari grup
     */
    async removeMember(Exp, groupId, userIds) {
        try {
            await Exp.groupParticipantsUpdate(groupId, userIds, 'remove');
            return true;
        } catch (error) {
            return false;
        }
    },

    /**
     * Add member ke grup
     */
    async addMember(Exp, groupId, userIds) {
        try {
            await Exp.groupParticipantsUpdate(groupId, userIds, 'add');
            return true;
        } catch (error) {
            return false;
        }
    },

    /**
     * Set group announcement mode
     */
    async setAnnouncement(Exp, groupId, enabled) {
        try {
            await Exp.groupSettingUpdate(groupId, 'announcement', enabled);
            return true;
        } catch (error) {
            return false;
        }
    },

    /**
     * Set group restricted mode
     */
    async setRestricted(Exp, groupId, enabled) {
        try {
            await Exp.groupSettingUpdate(groupId, 'restrict', enabled);
            return true;
        } catch (error) {
            return false;
        }
    },

    /**
     * Get invite info
     */
    async getInviteInfo(Exp, inviteCode) {
        try {
            return await Exp.groupGetInviteInfo(inviteCode);
        } catch (error) {
            return null;
        }
    }
};

export default AdminDetector;
