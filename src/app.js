const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const { authMiddleware, adminOnly } = require('./middleware/auth');
const { logRequest, logger } = require('./middleware/logger');
const { globalLimiter, authLimiter } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const groupRoutes = require('./routes/groups');
const deviceRoutes = require('./routes/devices');
const positionRoutes = require('./routes/positions');
const commandRoutes = require('./routes/commands');
const reportRoutes = require('./routes/reports');
const healthRoutes = require('./routes/health');
const groupsAdminRoutes = require('./routes/groupsAdmin');
const deviceGroupsRoutes = require('./routes/deviceGroups');
const groupSyncRoutes = require('./routes/groupSync');
const customAttributesRoutes = require('./routes/customAttributes');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

app.use(helmet());
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(express.json());
app.use(requestId);
app.use(logRequest);

app.use(globalLimiter);

app.get('/', (req, res) => {
  res.json({ name: 'API Gateway - Unified GPS', version: '1.1.0', status: 'running' });
  req.log.info('Root endpoint hit');
});

app.use('/health', healthRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', authMiddleware, adminOnly, userRoutes);
app.use('/api/groups', authMiddleware, groupRoutes);
app.use('/api/devices', authMiddleware, deviceRoutes);
app.use('/api/positions', authMiddleware, positionRoutes);
app.use('/api/commands', authMiddleware, commandRoutes);
app.use('/api/reports', authMiddleware, reportRoutes);
app.use('/api/admin/groups', authMiddleware, adminOnly, groupsAdminRoutes);
app.use('/api/admin/device-groups', authMiddleware, adminOnly, deviceGroupsRoutes);
app.use('/api/admin/group-sync', authMiddleware, adminOnly, groupSyncRoutes);
app.use('/api/admin/custom-attributes', authMiddleware, adminOnly, customAttributesRoutes);
app.use('/api/dashboard', authMiddleware, dashboardRoutes);

app.use(errorHandler);

module.exports = app;
