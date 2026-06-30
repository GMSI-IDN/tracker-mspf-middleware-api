const express = require('express');
const createError = require('http-errors');
const db = require('../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const userGroups = req.user.groups || [];
    const isAdmin = req.user.role === 'admin';

    const customGroups = await db('groups').select('*');
    const groups = customGroups
      .filter(g => isAdmin || userGroups.includes(g.id))
      .map(g => ({
        id: g.id, name: g.name,
        description: g.description,
        source: 'custom',
        deviceCount: 0,
      }));

    res.json({ groups });
  } catch (err) {
    next(err);
  }
});

const ROOT_FIELDS = [
  'id', 'name', 'uniqueId', 'status', 'phone', 'model',
  'source', 'group', 'lastUpdate', 'running', 'ignition',
  'voltage', 'firmwareVersion', 'sats', 'speed', 'attributes',
];

const ENRICHED_ATTRS = [
  'ignition', 'voltage', 'sats', 'rssi', 'signal', 'running',
  'tid', 'mid', 'ts', 'code', 'kph', 'alt', 'dir', 'hdop', 'odom',
  'gpio', 'accm', 'ver', 'sno', 'relay', 'mode',
  'addr_IGN', 'addr_FIX', 'addr_EB', 'addr_IB', 'addr_AD',
  'addr_AD2', 'addr_TE', 'addr_RS', 'addr_NT', 'addr_x', 'addr_y', 'addr_z',
];

router.get('/:id/preview', async (req, res, next) => {
  try {
    const groupId = parseInt(req.params.id, 10);
    const group = await db('groups').where({ id: groupId }).first();
    if (!group) throw createError(404, 'Group not found', { code: 'ERR_NOT_FOUND' });

    const userGroups = req.user.groups || [];
    if (req.user.role !== 'admin' && !userGroups.includes(groupId)) {
      throw createError(403, 'Forbidden', { code: 'ERR_FORBIDDEN' });
    }

    const rules = await db('custom_attribute_rules')
      .where({ group_id: groupId, enabled: true })
      .orderBy('priority');

    let visibleAttributes;
    if (req.user.role === 'admin') {
      const ruleNames = rules.map(r => r.name);
      visibleAttributes = [...ENRICHED_ATTRS.filter(a => !ruleNames.includes(a)), ...ruleNames];
    } else {
      visibleAttributes = rules.map(r => r.name);
    }

    res.json({
      group: { id: group.id, name: group.name },
      rootFields: ROOT_FIELDS,
      visibleAttributes,
      totalVisible: ROOT_FIELDS.length + visibleAttributes.length,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
