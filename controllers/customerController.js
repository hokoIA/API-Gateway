// Arquivo: controllers/customerController.js
const { pool } = require('../config/db');
const { createCustomer, deleteCustomer, deactivateCustomer, getCustomerByIdCustomer, getCustomersByUserId, getCustomersListByUserId, removeCustomerPlatformAuth, updateCustomer, checkCustomerBelongsToUser } = require('../repositories/customerRepository');
const { refreshKeysForCustomer, getGoogleAnalyticsKeys, getLinkedinKeys, clearCacheForUser } = require('../helpers/keyHelper');
const metricsOrchestrator = require('../usecases/processCustomerMetricsUseCase');
const { syncExtraClientsForUser } = require('../services/stripeService');

/*const addCustomer = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { name, company, email, phone, platforms } = req.body;

    const id_customer = await createCustomer(
      id_user, name, company, email, phone,
      platforms.find(p => p.id_facebook_page)?.id_facebook_page || null,
      platforms.find(p => p.id_facebook_page)?.access_token || null,
      platforms.find(p => p.id_instagram_page)?.id_instagram_page || null,
      platforms.find(p => p.id_instagram_page)?.access_token || null,
      platforms.find(p => p.id_googleanalytics_property)?.id_googleanalytics_property || null,
      platforms.find(p => p.id_linkedin_organization)?.id_linkedin_organization || null,
    );

    const google = await getGoogleAnalyticsKeys(id_user, id_customer);
    const linkedin = await getLinkedinKeys(id_user, id_customer);

    // refatorar para todas plaraformas serem enviadas da mesma forma que o google e linkedin
    await metricsOrchestrator.processCustomerMetrics(id_user, id_customer, platforms, google, linkedin);

    return res.status(200).json({ success: true, message: 'Cliente e métricas adicionados com sucesso.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};*/

const addCustomer = async (req, res) => {
  try {
    const id_user = req.user.id;
    const { name, company, email, phone } = req.body;

    if (!name || !email) return res.status(400).json({ success: false, message: 'Nome e email são obrigatórios.' });


    const customer = await createCustomer(
      id_user,
      name,
      company || null,
      email,
      phone || null
    );

    // Atualiza quantidade de clientes extras (acima de 3) no Stripe
    try {
      console.log('[ADD_CUSTOMER] id_user=', id_user, 'created id_customer=', customer.id_customer);
      console.log('[ADD_CUSTOMER] calling syncExtraClientsForUser...');
      await syncExtraClientsForUser(id_user);
      console.log('[ADD_CUSTOMER] syncExtraClientsForUser done');
    } catch (err) {
      console.error('Erro ao sincronizar clientes extras no Stripe (addCustomer):', err);
      // não bloqueia criação de cliente
    }

    return res.status(201).json({
      success: true,
      message: 'Cliente criado com sucesso.',
      customer
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const deleteCustomerById = async (req, res) => {
  try {
    const id_user = req.user.id;
    const id_customer = req.params.id_customer;

    const belongs = await checkCustomerBelongsToUser(id_customer, id_user);
    if (!belongs) {
      return res.status(403).json({
        success: false,
        message: 'Cliente não pertence ao usuário autenticado.'
      });
    }

    // Soft delete: marca como inativo e registra data de desativação
    await deactivateCustomer(id_customer, id_user);

    clearCacheForUser(id_user);

    // Opcional: tentar sincronizar Stripe.
    // syncExtraClientsForUser *não* diminui extras no meio do ciclo (allowDecrease=false).
    try {
      await syncExtraClientsForUser(id_user);
    } catch (err) {
      console.error('Erro ao sincronizar clientes extras no Stripe (deleteCustomerById):', err);
    }

    res.status(200).json({
      success: true,
      message: 'Cliente desativado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao desativar cliente:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro ao desativar cliente'
    });
  }
};

const getCustomerById = async (req, res) => {
  try {
    const id_customer = req.params.id_customer;
    const customer = await getCustomerByIdCustomer(id_customer);
    res.status(200).json({ success: true, customer });
  } catch (error) {
    console.error('Erro ao buscar ciente:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar cliente' });
  }
};

const getCustomersByUser = async (req, res) => {
  try {
    const idUser = req.user.id;
    const customers = await getCustomersByUserId(idUser);
    res.status(200).json({ success: true, customers });
  } catch (error) {
    console.error('Erro ao buscar clientes:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar clientes' });
  }
};

const getCustomersList = async (req, res) => {
  try {
    const idUser = req.user.id;
    const customers = await getCustomersListByUserId(idUser);
    return res.status(200).json({ success: true, customers });
  } catch (error) {
    console.error('Erro ao buscar clientes (list):', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar clientes' });
  }
};

const refreshCustomerKeys = async (req, res) => {
  try {
    const { id_customer } = req.body;
    const id_account = req.user.id_account;

    if (!id_customer) {
      return res.status(400).json({
        success: false,
        message: 'id_customer é obrigatório.'
      });
    }

    const adminResult = await pool.query(
      `
      SELECT u.id_user
      FROM "user" u
      JOIN team_members tm
        ON tm.id_user = u.id_user
       AND tm.id_account = u.id_account
       AND tm.status = 'active'
      JOIN member_roles mr
        ON mr.id_team_member = tm.id_team_member
      JOIN roles r
        ON r.id_role = mr.id_role
      WHERE u.id_account = $1
        AND lower(r.name) = 'admin'
      ORDER BY u.id_user ASC
      LIMIT 1
      `,
      [id_account]
    );

    if (adminResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Administrador da conta não encontrado.'
      });
    }

    const owner_user_id = adminResult.rows[0].id_user;

    await refreshKeysForCustomer(owner_user_id, id_customer);

    res.status(200).json({
      success: true,
      message: 'Chaves atualizadas em cache'
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

const removePlatformCustomerById = async (req, res) => {
  try {
    const id_user = req.user.id;
    const id_customer = req.params.id_customer;
    const platform = (req.params.platform || '').toLowerCase();

    const allowed = [
      'facebook',
      'instagram',
      'meta_ads',
      'google_ads',
      'linkedin',
      'google_analytics',
      'youtube'
    ];
    if (!allowed.includes(platform)) return res.status(400).json({ success: false, message: 'Plataforma inválida' });

    const belongs = await checkCustomerBelongsToUser(id_customer, id_user);
    if (!belongs) return res.status(403).json({ success: false, message: 'Cliente não pertence ao usuário autenticado.' });

    await removeCustomerPlatformAuth(id_customer, platform);

    clearCacheForUser(id_user);

    return res.status(200).json({ success: true, message: 'Plataforma desconectada do cliente com sucesso' });
  } catch (error) {
    console.error('Erro ao desconectar plataforma do cliente:', error);
    return res.status(500).json({ success: false, message: error.message || 'Erro ao desconectar plataforma' });
  }
};

const updateCustomerById = async (req, res) => {
  try {
    const id_user = req.user.id;
    const id_customer = req.params.id_customer;
    const { name, email, company, phone } = req.body;

    // Validar se os campos obrigatórios foram enviados
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Nome e email são obrigatórios'
      });
    }

    // Você precisará criar esta função no repository
    const updated = await updateCustomer(id_customer, id_user, name, email, company || null, phone || null);

    res.status(200).json({
      success: true,
      message: 'Cliente atualizado com sucesso',
      customer: updated
    });
  } catch (error) {
    console.error('Erro ao atualizar cliente:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro ao atualizar cliente'
    });
  }
};

module.exports = { addCustomer, deleteCustomerById, getCustomerById, getCustomersByUser, getCustomersList, refreshCustomerKeys, removePlatformCustomerById, updateCustomerById };
