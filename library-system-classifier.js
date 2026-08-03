'use strict';

const path = require('path');

const CONTAINER_EXTENSIONS = new Set(['.zip', '.7z', '.rar']);

function parseArchiveEntryExtensions(output) {
  const extensions = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.trim().match(/(\.[a-z0-9]{1,8})$/i);
    if (match) extensions.add(match[1].toLowerCase());
  }
  return extensions;
}

function parseDolphinHeaderSystem(output) {
  try {
    const header = typeof output === 'string' ? JSON.parse(output) : output;
    if (!header || typeof header !== 'object') return '';
    if (Number(header.title_id || 0) > 0) return 'wii';
    if (String(header.game_id || '').trim() || String(header.internal_name || '').trim()) return 'gamecube';
  } catch {}
  return '';
}

function parseDiscHeaderSystem(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (buffer.length < 32) return '';
  const wiiMagic = Buffer.from([0x5d, 0x1c, 0x9e, 0xa3]);
  const gameCubeMagic = Buffer.from([0xc2, 0x33, 0x9f, 0x3d]);
  if (buffer.indexOf(wiiMagic) >= 0) return 'wii';
  if (buffer.indexOf(gameCubeMagic) >= 0) return 'gamecube';
  return '';
}

function contentScore(system, archiveExtensions) {
  let score = 0;
  for (const extension of system.exts || []) {
    const normalized = String(extension || '').toLowerCase();
    if (!normalized || CONTAINER_EXTENSIONS.has(normalized)) continue;
    if (archiveExtensions.has(normalized)) score += normalized === '.bin' ? 1 : 3;
  }
  return score;
}

function chooseLibrarySystem(candidates, context = {}) {
  const extension = String(context.fileExtension || '').toLowerCase();
  const compatible = (candidates || []).filter(system => (system.exts || []).includes(extension));
  if (compatible.length === 1) return compatible[0];
  if (!compatible.length) return null;

  const discSystemId = String(context.discSystemId || '');
  if (discSystemId) {
    const discMatch = compatible.find(system => system.id === discSystemId);
    if (discMatch) return discMatch;
  }

  const archiveExtensions = context.archiveExtensions instanceof Set
    ? context.archiveExtensions
    : new Set(context.archiveExtensions || []);
  if (archiveExtensions.size) {
    const ranked = compatible
      .map(system => ({ system, score: contentScore(system, archiveExtensions) }))
      .sort((a, b) => b.score - a.score || a.system.id.localeCompare(b.system.id));
    if (ranked[0].score > 0 && ranked[0].score > (ranked[1]?.score || 0)) return ranked[0].system;
  }

  const directSystemId = String(context.directSystemId || '');
  if (!context.sharedRoot && directSystemId) {
    const direct = compatible.find(system => system.id === directSystemId);
    if (direct) return direct;
  }
  return null;
}

function fileExtension(file) {
  return path.extname(String(file || '')).toLowerCase();
}

module.exports = {
  chooseLibrarySystem,
  fileExtension,
  parseArchiveEntryExtensions,
  parseDiscHeaderSystem,
  parseDolphinHeaderSystem
};
