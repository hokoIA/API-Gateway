const repo = require('../repositories/kanbanRepository');
const { FRONTEND_PATHS, buildFrontendUrl } = require('../config/urls');

const ok = (res, data) => res.status(200).json(data);
const fail = (res, error) => res.status(400).json({ success: false, message: error?.message || 'Erro no Kanban.' });

async function getBoardData(req, res) {
  try {
    return ok(res, await repo.listBoardData(req.user.id, req.user.id_account));
  } catch (error) {
    console.error('kanbanController.getBoardData:', error);
    return fail(res, error);
  }
}

async function listTeam(req, res) {
  try {
    return ok(res, { success: true, team: await repo.listTeam(req.user.id, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.listTeam:', error);
    return fail(res, error);
  }
}

async function listClientsWithProfile(req, res) {
  try {
    return ok(res, { success: true, clients: await repo.listClientsWithProfile(req.user.id, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.listClientsWithProfile:', error);
    return fail(res, error);
  }
}

async function upsertClientProfileByCustomerId(req, res) {
  try {
    const idCustomer = Number(req.params.id_customer);
    if (!idCustomer) throw new Error('id_customer inválido.');
    const profile = await repo.upsertClientProfile(req.user.id, idCustomer, req.body || {}, req.user.id_account);
    return ok(res, { success: true, profile });
  } catch (error) {
    console.error('kanbanController.upsertClientProfileByCustomerId:', error);
    return fail(res, error);
  }
}

async function deleteClientProfileByCustomerId(req, res) {
  try {
    const idCustomer = Number(req.params.id_customer);
    if (!idCustomer) throw new Error('id_customer inválido.');
    await repo.deleteClientProfile(req.user.id, idCustomer, req.user.id_account);
    return res.status(204).send();
  } catch (error) {
    console.error('kanbanController.deleteClientProfileByCustomerId:', error);
    return fail(res, error);
  }
}

async function getClientPortalLink(req, res) {
  try {
    const idCustomer = Number(req.params.id_customer);
    if (!idCustomer) throw new Error('id_customer inválido.');
    const { external_token, client_name } = await repo.getOrCreateClientPortalToken(req.user.id, idCustomer, req.user.id_account);
    const slug = String(client_name || 'cliente')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    return ok(res, {
      success: true,
      token: external_token,
      url: buildFrontendUrl(`${FRONTEND_PATHS.clientApprovals}/${encodeURIComponent(slug || 'cliente')}`, {
        token: external_token
      })
    });
  } catch (error) {
    console.error('kanbanController.getClientPortalLink:', error);
    return fail(res, error);
  }
}

async function listLabels(req, res) {
  try {
    return ok(res, { success: true, labels: await repo.listLabels(req.user.id, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.listLabels:', error);
    return fail(res, error);
  }
}

async function createLabel(req, res) {
  try {
    return ok(res, { success: true, label: await repo.createLabel(req.user.id, req.body || {}, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.createLabel:', error);
    return fail(res, error);
  }
}

async function updateLabel(req, res) {
  try {
    return ok(res, { success: true, label: await repo.updateLabel(req.user.id, req.params.id, req.body || {}, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.updateLabel:', error);
    return fail(res, error);
  }
}

async function deleteLabel(req, res) {
  try {
    await repo.deleteLabel(req.user.id, req.params.id, req.user.id_account);
    return res.status(204).send();
  } catch (error) {
    console.error('kanbanController.deleteLabel:', error);
    return fail(res, error);
  }
}

async function listColumns(req, res) {
  try {
    return ok(res, { success: true, columns: await repo.listColumns(req.user.id, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.listColumns:', error);
    return fail(res, error);
  }
}

async function createColumn(req, res) {
  try {
    return ok(res, { success: true, column: await repo.createColumn(req.user.id, req.body || {}, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.createColumn:', error);
    return fail(res, error);
  }
}

async function updateColumn(req, res) {
  try {
    return ok(res, { success: true, column: await repo.updateColumn(req.user.id, req.params.id, req.body || {}, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.updateColumn:', error);
    return fail(res, error);
  }
}

async function deleteColumn(req, res) {
  try {
    await repo.deleteColumn(req.user.id, req.params.id, req.user.id_account);
    return res.status(204).send();
  } catch (error) {
    console.error('kanbanController.deleteColumn:', error);
    return fail(res, error);
  }
}

async function reorderColumns(req, res) {
  try {
    const columnIds = Array.isArray(req.body?.column_ids) ? req.body.column_ids : [];
    await repo.reorderColumns(req.user.id, columnIds, req.user.id_account);
    return ok(res, { success: true });
  } catch (error) {
    console.error('kanbanController.reorderColumns:', error);
    return fail(res, error);
  }
}

async function listCards(req, res) {
  try {
    return ok(res, { success: true, cards: await repo.listCardsAll(req.user.id, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.listCards:', error);
    return fail(res, error);
  }
}

async function getCardExpanded(req, res) {
  try {
    return ok(res, { success: true, card: await repo.getCardByIdExpanded(req.user.id, req.params.id, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.getCardExpanded:', error);
    return fail(res, error);
  }
}

async function createCard(req, res) {
  try {
    return ok(res, { success: true, card: await repo.createCard(req.user.id, req.body || {}, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.createCard:', error);
    return fail(res, error);
  }
}

async function updateCard(req, res) {
  try {
    return ok(res, { success: true, card: await repo.updateCard(req.user.id, req.params.id, req.body || {}, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.updateCard:', error);
    return fail(res, error);
  }
}

async function deleteCard(req, res) {
  try {
    await repo.deleteCard(req.user.id, req.params.id, req.user.id_account);
    return res.status(204).send();
  } catch (error) {
    console.error('kanbanController.deleteCard:', error);
    return fail(res, error);
  }
}

async function moveCard(req, res) {
  try {
    return ok(res, { success: true, card: await repo.moveCard(req.user.id, req.params.id, req.body || {}, req.user.id_account) });
  } catch (error) {
    console.error('kanbanController.moveCard:', error);
    return fail(res, error);
  }
}

module.exports = {
  getBoardData,
  listTeam,
  listClientsWithProfile,
  upsertClientProfileByCustomerId,
  deleteClientProfileByCustomerId,
  getClientPortalLink,
  listLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  listColumns,
  createColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
  listCards,
  getCardExpanded,
  createCard,
  updateCard,
  deleteCard,
  moveCard
};
