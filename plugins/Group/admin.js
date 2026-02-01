let handler = async (m, { q, conn, isOwner, command, setReply }) => {
  if (!m.isGroup) return setReply(mess.only.group);
  if (!m.isAdmin && !isOwner) return setReply(mess.only.admin);
  if (!m.isBotAdmin && !isOwner) return setReply(mess.only.Badmin);
  if (!m.users) return setReply("reply/tag targetnya");
  
  // EXPERIMENTAL-BELL PATTERN: Multi-attempt promote with fresh metadata on failure
  let target = m.users;
  if (!target.includes('@')) {
    target = target.replace(/[()+-/ +/]/g, '') + '@s.whatsapp.net';
  }
  
  const targetName = target.split('@')[0];
  
  // Attempt 1: Try with cached metadata
  try {
    await conn.groupParticipantsUpdate(m.chat, [target], "promote");
    return setReply(`✅ Sukses Promote @${targetName}`);
  } catch (err) {
    // If first attempt fails, refresh metadata and retry
    try {
      const fresh = await conn.refreshGroupMetadata(m.chat).catch(() => null);
      if (fresh && fresh.participants) {
        // Second attempt: Try again with fresh metadata
        await conn.groupParticipantsUpdate(m.chat, [target], "promote");
        return setReply(`✅ Sukses Promote @${targetName} (retry)`);
      }
    } catch (retryErr) {
      return setReply(`❌ Gagal promote: ${retryErr?.message || retryErr}`);
    }
    return setReply(`❌ Gagal promote: ${err?.message || err}`);
  }
};

handler.tags = ["admin"];
handler.command = ["admin","promote"];
handler.group = true;

export default handler;
