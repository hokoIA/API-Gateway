const cors = require('cors');
const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
dotenv.config();

const { handleStripeWebhook } = require('./controllers/stripeWebhookController');
const billingRoutes = require('./routes/billingRoutes');
const { testConnection } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const contactRoutes = require('./routes/contactRoutes');
const contentsRoutes = require('./routes/contentsRoutes');
const customerRoutes = require('./routes/customerRoutes');
const goalsRoutes = require('./routes/goalsRoutes');
const kanbanRoutes = require('./routes/kanbanRoutes');
const metricsRoutes = require('./routes/metricsRoutes');
const googleAnalyticsRoutes = require('./routes/googleAnalyticsRoutes');
const googleAdsRoutes = require('./routes/googleAdsRoutes');
const linkedinRoutes = require('./routes/linkedinRoutes');
const metaRoutes = require('./routes/metaRoutes');
const youtubeRoutes = require('./routes/youtubeRoutes');
const rbacRoutes = require('./routes/rbacRoutes');
const teamRoutes = require('./routes/teamRoutes');
const { getCorsAllowedOrigins } = require('./config/security');

const app = express();
const allowedOrigins = getCorsAllowedOrigins();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Origin nao permitida: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api', authRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/contents', contentsRoutes);
app.use('/api/kanban', kanbanRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/googleAnalytics', googleAnalyticsRoutes);
app.use('/api/googleAds', googleAdsRoutes);
app.use('/api/linkedin', linkedinRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/rbac', rbacRoutes);
app.use('/api/team', teamRoutes);
app.use('/customer', customerRoutes);

app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'api-gateway'
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Rota nao encontrada'
  });
});

app.listen(port, async () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
  await testConnection();
});

module.exports = app;
