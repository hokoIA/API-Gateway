// Arquivo: controllers/metricsController.js
const facebookService = require('../services/facebookService');
const instagramService = require('../services/instagramService');
const { getAllKeys } = require('../helpers/keyHelper');

exports.getReachMetrics = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { id_customer, startDate, endDate } = req.body;
    const { facebook, instagram } = await getAllKeys(id_user, id_customer);

    const [facebookData, instagramData] = await Promise.all([
      facebookService.getReach(facebook.page_id, facebook.access_token, startDate, endDate),
      instagramService.getReach(instagram.page_id, instagram.access_token, startDate, endDate)
    ]);

    const labels = facebookData.map((_, i) => {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      return date.toISOString().split('T')[0];
    });

    res.json({
      labels,
      facebook: facebookData,
      instagram: instagramData
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao buscar dados de alcance' });
  }
};

