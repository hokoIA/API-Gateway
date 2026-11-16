const crypto = require('crypto');
const { pool } = require('../config/db');

async function getAccountId(id_user, id_account = null) {
  if (id_account) return Number(id_account);
  const { rows } = await pool.query('SELECT id_account FROM "user" WHERE id_user = $1 LIMIT 1', [Number(id_user)]);
  const accountId = rows[0]?.id_account;
  if (!accountId) throw new Error('Conta não encontrada para este usuário.');
  return Number(accountId);
}

async function getDefaultBoard(id_account, client = pool) {
  const db = client && typeof client.query === 'function' ? client : pool;

  let { rows } = await db.query(
    `SELECT *
       FROM kanban.board
      WHERE id_account = $1
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1`,
    [Number(id_account)]
  );

  if (rows[0]) return rows[0];

  const created = await db.query(
    `INSERT INTO kanban.board (id_account, name, is_default)
     VALUES ($1, 'Quadro principal', TRUE)
     RETURNING *`,
    [Number(id_account)]
  );

  const board = created.rows[0];

  await db.query(
    `INSERT INTO kanban.board_column (board_id, name, position, color)
     VALUES
       ($1, 'A fazer', 1, '#696cff'),
       ($1, 'Em andamento', 2, '#03c3ec'),
       ($1, 'Em revisão', 3, '#ffab00'),
       ($1, 'Concluído', 4, '#71dd37')`,
    [board.id]
  );

  return board;
}

async function listTeam(id_user, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);

  const { rows } = await pool.query(
    `SELECT
        u.id_user,
        u.name
      FROM team_members tm
      JOIN "user" u ON u.id_user = tm.id_user
      WHERE tm.id_account = $1
        AND tm.status = 'active'
      ORDER BY lower(u.name) ASC`,
    [accountId]
  );

  return rows;
}

async function listClientsWithProfile(id_user, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const { rows } = await pool.query(
    `SELECT
        c.id_customer,
        c.name,
        cp.id AS client_profile_id,
        cp.external_token,
        cp.role_briefing_name,
        cp.role_design_name,
        cp.role_text_name,
        cp.role_review_name,
        cp.role_schedule_name
      FROM customer c
      JOIN "user" owner_u ON owner_u.id_user = c.id_user
      LEFT JOIN kanban.client_profile cp ON cp.id_customer = c.id_customer AND cp.id_user = owner_u.id_user
      WHERE owner_u.id_account = $1 AND c.status <> 'activating'
      ORDER BY lower(c.name) ASC`,
    [accountId]
  );

  return rows.map((row) => ({
    id_customer: row.id_customer,
    name: row.name,
    client_profile_id: row.client_profile_id,
    external_token: row.external_token,
    roles: {
      briefing: row.role_briefing_name || '',
      design: row.role_design_name || '',
      text: row.role_text_name || '',
      review: row.role_review_name || '',
      schedule: row.role_schedule_name || ''
    }
  }));
}

async function upsertClientProfile(id_user, id_customer, payload, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);

  const ownership = await pool.query(
    `SELECT c.id_customer
       FROM customer c
       JOIN "user" u ON u.id_user = c.id_user
      WHERE c.id_customer = $1
        AND u.id_account = $2
      LIMIT 1`,
    [Number(id_customer), accountId]
  );
  if (!ownership.rows.length) throw new Error('Cliente não encontrado para esta conta.');

  const externalToken = crypto.randomBytes(24).toString('hex');
  const { rows } = await pool.query(
    `INSERT INTO kanban.client_profile (
        id_user,
        id_customer,
        role_briefing_name,
        role_design_name,
        role_text_name,
        role_review_name,
        role_schedule_name,
        external_token,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
      ON CONFLICT (id_customer)
      DO UPDATE SET
        id_user = EXCLUDED.id_user,
        role_briefing_name = EXCLUDED.role_briefing_name,
        role_design_name = EXCLUDED.role_design_name,
        role_text_name = EXCLUDED.role_text_name,
        role_review_name = EXCLUDED.role_review_name,
        role_schedule_name = EXCLUDED.role_schedule_name,
        updated_at = now()
      RETURNING *`,
    [
      Number(id_user),
      Number(id_customer),
      payload?.role_briefing_name || null,
      payload?.role_design_name || null,
      payload?.role_text_name || null,
      payload?.role_review_name || null,
      payload?.role_schedule_name || null,
      externalToken
    ]
  );

  return rows[0];
}

async function deleteClientProfile(id_user, id_customer, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  await pool.query(
    `DELETE FROM kanban.client_profile cp
      USING customer c, "user" u
      WHERE cp.id_customer = c.id_customer
        AND u.id_user = c.id_user
        AND c.id_customer = $1
        AND u.id_account = $2`,
    [Number(id_customer), accountId]
  );
}

async function getOrCreateClientPortalToken(id_user, id_customer, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const existing = await pool.query(
    `SELECT cp.external_token, c.name AS client_name
       FROM kanban.client_profile cp
       JOIN customer c ON c.id_customer = cp.id_customer
       JOIN "user" u ON u.id_user = c.id_user
      WHERE cp.id_customer = $1
        AND u.id_account = $2
      LIMIT 1`,
    [Number(id_customer), accountId]
  );

  if (existing.rows[0]?.external_token) return existing.rows[0];

  await upsertClientProfile(id_user, id_customer, {}, accountId);

  const created = await pool.query(
    `SELECT cp.external_token, c.name AS client_name
       FROM kanban.client_profile cp
       JOIN customer c ON c.id_customer = cp.id_customer
       JOIN "user" u ON u.id_user = c.id_user
      WHERE cp.id_customer = $1
        AND u.id_account = $2
      LIMIT 1`,
    [Number(id_customer), accountId]
  );

  return created.rows[0];
}

async function getClientProfileByToken(token) {
  if (!token) throw new Error('Token inválido.');
  const { rows } = await pool.query(
    `SELECT
        cp.*, c.name AS client_name, u.id_account
      FROM kanban.client_profile cp
      JOIN customer c ON c.id_customer = cp.id_customer
      JOIN "user" u ON u.id_user = c.id_user
      WHERE cp.external_token = $1
      LIMIT 1`,
    [String(token)]
  );
  if (!rows.length) throw new Error('Link do cliente inválido.');
  return rows[0];
}

async function listLabels(id_user, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const { rows } = await pool.query(
    `SELECT * FROM kanban.label WHERE id_account = $1 ORDER BY lower(name) ASC`,
    [accountId]
  );
  return rows;
}

async function createLabel(id_user, payload, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const name = String(payload?.name || '').trim();
  const color = String(payload?.color || '#696cff').trim();
  if (!name) throw new Error('Nome da etiqueta é obrigatório.');

  const { rows } = await pool.query(
    `INSERT INTO kanban.label (id_account, name, color)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [accountId, name, color]
  );
  return rows[0];
}

async function updateLabel(id_user, labelId, payload, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const name = String(payload?.name || '').trim();
  const color = String(payload?.color || '#696cff').trim();
  if (!name) throw new Error('Nome da etiqueta é obrigatório.');

  const { rows } = await pool.query(
    `UPDATE kanban.label
        SET name = $3,
            color = $4,
            updated_at = now()
      WHERE id = $1
        AND id_account = $2
      RETURNING *`,
    [labelId, accountId, name, color]
  );
  if (!rows.length) throw new Error('Etiqueta não encontrada.');
  return rows[0];
}

async function deleteLabel(id_user, labelId, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  await pool.query(`DELETE FROM kanban.label WHERE id = $1 AND id_account = $2`, [labelId, accountId]);
}

async function listColumns(id_user, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const board = await getDefaultBoard(accountId);
  const { rows } = await pool.query(
    `SELECT * FROM kanban.board_column WHERE board_id = $1 ORDER BY position ASC, created_at ASC`,
    [board.id]
  );
  return rows;
}

async function createColumn(id_user, payload, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const board = await getDefaultBoard(accountId);
  const name = String(payload?.name || '').trim();
  const color = String(payload?.color || '#8592a3').trim();
  if (!name) throw new Error('Nome da coluna é obrigatório.');

  const next = await pool.query(
    `SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM kanban.board_column WHERE board_id = $1`,
    [board.id]
  );

  const { rows } = await pool.query(
    `INSERT INTO kanban.board_column (board_id, name, color, position)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [board.id, name, color, Number(next.rows[0].next_position || 1)]
  );
  return rows[0];
}

async function updateColumn(id_user, columnId, payload, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const name = String(payload?.name || '').trim();
  const color = String(payload?.color || '#8592a3').trim();
  if (!name) throw new Error('Nome da coluna é obrigatório.');

  const { rows } = await pool.query(
    `UPDATE kanban.board_column c
        SET name = $3,
            color = $4,
            updated_at = now()
       FROM kanban.board b
      WHERE c.id = $1
        AND c.board_id = b.id
        AND b.id_account = $2
      RETURNING c.*`,
    [columnId, accountId, name, color]
  );
  if (!rows.length) throw new Error('Coluna não encontrada.');
  return rows[0];
}

async function deleteColumn(id_user, columnId, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const inUse = await pool.query(
    `SELECT 1
       FROM kanban.card k
       JOIN kanban.board b ON b.id = k.board_id
      WHERE k.column_id = $1
        AND b.id_account = $2
      LIMIT 1`,
    [columnId, accountId]
  );
  if (inUse.rows.length) throw new Error('Esta coluna possui cards. Mova os cards antes de excluir.');

  await pool.query(
    `DELETE FROM kanban.board_column c
      USING kanban.board b
      WHERE c.id = $1
        AND c.board_id = b.id
        AND b.id_account = $2`,
    [columnId, accountId]
  );
}

async function reorderColumns(id_user, orderedColumnIds = []) {
  if (!Array.isArray(orderedColumnIds) || !orderedColumnIds.length) {
    throw new Error('orderedColumnIds obrigatório');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const accountId = await getAccountId(id_user);
    const board = await getDefaultBoard(accountId, client);

    const existingRes = await client.query(
      `
      SELECT id
      FROM kanban.board_column
      WHERE board_id = $1
      `,
      [board.id]
    );

    const existingIds = existingRes.rows.map(r => String(r.id));
    const incomingIds = orderedColumnIds.map(id => String(id));

    if (existingIds.length !== incomingIds.length) {
      throw new Error('Quantidade de colunas inválida para reordenação');
    }

    const existingSet = new Set(existingIds);
    for (const id of incomingIds) {
      if (!existingSet.has(id)) {
        throw new Error('Coluna inválida na reordenação');
      }
    }

    // Etapa 1: posições temporárias negativas para evitar colisão de UNIQUE(board_id, position)
    for (let i = 0; i < incomingIds.length; i++) {
      await client.query(
        `
        UPDATE kanban.board_column
        SET position = $1,
            updated_at = NOW()
        WHERE id = $2
          AND board_id = $3
        `,
        [-(i + 1), incomingIds[i], board.id]
      );
    }

    // Etapa 2: posições finais
    for (let i = 0; i < incomingIds.length; i++) {
      await client.query(
        `
        UPDATE kanban.board_column
        SET position = $1,
            updated_at = NOW()
        WHERE id = $2
          AND board_id = $3
        `,
        [i + 1, incomingIds[i], board.id]
      );
    }

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listCardsAll(id_user, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const board = await getDefaultBoard(accountId);
  const baseRes = await pool.query(
    `SELECT
        k.*, c.name AS client_name
      FROM kanban.card k
      LEFT JOIN customer c ON c.id_customer = k.id_customer
      WHERE k.board_id = $1
      ORDER BY k.position ASC, k.created_at ASC`,
    [board.id]
  );
  return hydrateCards(baseRes.rows);
}

async function getCardByIdExpanded(id_user, cardId, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const { rows } = await pool.query(
    `SELECT
        k.*, c.name AS client_name
      FROM kanban.card k
      JOIN kanban.board b ON b.id = k.board_id
      LEFT JOIN customer c ON c.id_customer = k.id_customer
      WHERE k.id = $1
        AND b.id_account = $2
      LIMIT 1`,
    [cardId, accountId]
  );
  if (!rows.length) throw new Error('Card não encontrado.');
  const hydrated = await hydrateCards(rows);
  return hydrated[0];
}

async function hydrateCards(cards) {
  if (!cards.length) return [];
  const cardIds = cards.map((c) => c.id);

  const [labelsRes, assigneesRes, commentsRes] = await Promise.all([
    pool.query(
      `SELECT cl.card_id, l.id, l.name, l.color
         FROM kanban.card_label cl
         JOIN kanban.label l ON l.id = cl.label_id
        WHERE cl.card_id = ANY($1::uuid[])
        ORDER BY lower(l.name) ASC`,
      [cardIds]
    ),
    pool.query(
      `SELECT ca.card_id, u.id_user AS id, u.name
         FROM kanban.card_assignee ca
         JOIN "user" u ON u.id_user = ca.assignee_user_id
        WHERE ca.card_id = ANY($1::uuid[])
        ORDER BY lower(u.name) ASC`,
      [cardIds]
    ),
    pool.query(
      `SELECT cc.card_id, cc.id, cc.actor_type, cc.author, cc.body, cc.created_at
         FROM kanban.card_comment cc
        WHERE cc.card_id = ANY($1::uuid[])
        ORDER BY cc.created_at ASC`,
      [cardIds]
    )
  ]);

  return cards.map((card) => ({
    ...card,
    labels: labelsRes.rows.filter((r) => r.card_id === card.id).map((r) => ({ id: r.id, name: r.name, color: r.color })),
    assignees: assigneesRes.rows.filter((r) => r.card_id === card.id).map((r) => ({ id: r.id, name: r.name })),
    client_comments: commentsRes.rows.filter((r) => r.card_id === card.id).map((r) => ({
      id: r.id,
      actor_type: r.actor_type,
      author: r.author,
      text: r.body,
      created_at: r.created_at
    }))
  }));
}

async function syncCardLabels(client, cardId, labelIds) {
  await client.query('DELETE FROM kanban.card_label WHERE card_id = $1', [cardId]);
  if (!labelIds.length) return;
  for (const labelId of labelIds) {
    await client.query(
      `INSERT INTO kanban.card_label (card_id, label_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [cardId, labelId]
    );
  }
}

async function syncCardAssignees(cardId, client, assignees = []) {
  const dbClient = client && typeof client.query === 'function' ? client : pool;

  const normalized = [...new Set(
    (Array.isArray(assignees) ? assignees : [])
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0)
  )];

  await dbClient.query(
    `DELETE FROM kanban.card_assignee WHERE card_id = $1`,
    [cardId]
  );

  if (!normalized.length) return;

  const validUsersRes = await dbClient.query(
    `SELECT id_user
       FROM "user"
      WHERE id_user = ANY($1::int[])`,
    [normalized]
  );

  const validUsers = validUsersRes.rows.map((r) => Number(r.id_user));

  if (!validUsers.length) return;

  const values = [];
  const params = [];
  let idx = 1;

  for (const userId of validUsers) {
    values.push(`($${idx++}, $${idx++})`);
    params.push(cardId, userId);
  }

  await dbClient.query(
    `INSERT INTO kanban.card_assignee (card_id, assignee_user_id)
     VALUES ${values.join(', ')}
     ON CONFLICT DO NOTHING`,
    params
  );
}

async function createCard(id_user, payload, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const title = String(payload?.title || '').trim();
  if (!title) throw new Error('Título do card é obrigatório.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const board = await getDefaultBoard(accountId, client);

    let columnId = payload?.column_id;
    if (!columnId) {
      const firstColumnRes = await client.query(
        `SELECT id
           FROM kanban.board_column
          WHERE board_id = $1
          ORDER BY position ASC, created_at ASC
          LIMIT 1`,
        [board.id]
      );
      columnId = firstColumnRes.rows[0]?.id;
    }

    if (!columnId) throw new Error('Nenhuma coluna disponível para este quadro.');

    const positionRes = await client.query(
      `SELECT COALESCE(MAX(position), 0) + 1 AS next_position
         FROM kanban.card
        WHERE column_id = $1`,
      [columnId]
    );

    const inserted = await client.query(
      `INSERT INTO kanban.card (
          board_id, id_account, id_customer, title, week, due_date, copy_text, column_id, position, created_by_user_id, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
        RETURNING *`,
      [
        board.id,
        accountId,
        payload?.id_customer ? Number(payload.id_customer) : null,
        title,
        ['S1', 'S2', 'S3', 'S4'].includes(payload?.week) ? payload.week : 'S1',
        payload?.due_date || null,
        payload?.copy_text || null,
        columnId,
        Number(positionRes.rows[0].next_position || 1),
        Number(id_user)
      ]
    );

    const card = inserted.rows[0];
    await syncCardLabels(client, card.id, Array.isArray(payload?.label_ids) ? payload.label_ids : []);
    await syncCardAssignees(card.id, client, Array.isArray(payload?.assignee_ids) ? payload.assignee_ids : []);

    await client.query('COMMIT');
    return getCardByIdExpanded(id_user, card.id, accountId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateCard(id_user, cardId, payload, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const title = String(payload?.title || '').trim();
  if (!title) throw new Error('Título do card é obrigatório.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE kanban.card k
          SET id_customer = $3,
              title = $4,
              week = $5,
              due_date = $6,
              copy_text = $7,
              column_id = $8,
              updated_at = now()
         FROM kanban.board b
        WHERE k.id = $1
          AND k.board_id = b.id
          AND b.id_account = $2
        RETURNING k.*`,
      [
        cardId,
        accountId,
        payload?.id_customer ? Number(payload.id_customer) : null,
        title,
        ['S1', 'S2', 'S3', 'S4'].includes(payload?.week) ? payload.week : 'S1',
        payload?.due_date || null,
        payload?.copy_text || null,
        payload?.column_id || null
      ]
    );
    if (!updated.rows.length) throw new Error('Card não encontrado.');
    await syncCardLabels(client, cardId, Array.isArray(payload?.label_ids) ? payload.label_ids : []);
    await syncCardAssignees(cardId, client, Array.isArray(payload?.assignee_ids) ? payload.assignee_ids : []);
    await client.query('COMMIT');
    return getCardByIdExpanded(id_user, cardId, accountId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteCard(id_user, cardId, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  await pool.query(
    `DELETE FROM kanban.card k
      USING kanban.board b
      WHERE k.id = $1
        AND k.board_id = b.id
        AND b.id_account = $2`,
    [cardId, accountId]
  );
}

async function moveCard(id_user, cardId, payload, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const columnId = payload?.column_id;
  const position = Number(payload?.position || 1);
  if (!columnId) throw new Error('column_id é obrigatório.');

  const { rows } = await pool.query(
    `UPDATE kanban.card k
        SET column_id = $3,
            position = $4,
            updated_at = now()
       FROM kanban.board b
      WHERE k.id = $1
        AND k.board_id = b.id
        AND b.id_account = $2
      RETURNING k.*`,
    [cardId, accountId, columnId, position]
  );
  if (!rows.length) throw new Error('Card não encontrado.');
  return rows[0];
}

async function listBoardData(id_user, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const [board, columns, labels, clients, team, cards] = await Promise.all([
    getDefaultBoard(accountId),
    listColumns(id_user, accountId),
    listLabels(id_user, accountId),
    listClientsWithProfile(id_user, accountId),
    listTeam(id_user, accountId),
    listCardsAll(id_user, accountId)
  ]);

  return {
    success: true,
    board,
    columns,
    labels,
    clients,
    team,
    cards
  };
}

async function addComment(id_user, cardId, actorType, author, body, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const text = String(body || '').trim();
  if (!text) throw new Error('Comentário vazio.');

  const { rows } = await pool.query(
    `INSERT INTO kanban.card_comment (card_id, actor_type, author, body)
     SELECT k.id, $3, $4, $5
       FROM kanban.card k
       JOIN kanban.board b ON b.id = k.board_id
      WHERE k.id = $1
        AND b.id_account = $2
      RETURNING *`,
    [cardId, accountId, actorType, author || null, text]
  );
  if (!rows.length) throw new Error('Card não encontrado.');
  return rows[0];
}

async function listComments(id_user, cardId, id_account = null) {
  const accountId = await getAccountId(id_user, id_account);
  const { rows } = await pool.query(
    `SELECT cc.*
       FROM kanban.card_comment cc
       JOIN kanban.card k ON k.id = cc.card_id
       JOIN kanban.board b ON b.id = k.board_id
      WHERE cc.card_id = $1
        AND b.id_account = $2
      ORDER BY cc.created_at ASC`,
    [cardId, accountId]
  );
  return rows;
}

async function listExternalCards(token) {
  const profile = await getClientProfileByToken(token);
  const { rows } = await pool.query(
    `SELECT k.id, k.title, k.week, k.due_date, k.copy_text, k.column_id, bc.name AS column_name
       FROM kanban.card k
       LEFT JOIN kanban.board_column bc ON bc.id = k.column_id
      WHERE k.id_customer = $1
      ORDER BY COALESCE(bc.position, 999), k.position ASC, k.created_at ASC`,
    [profile.id_customer]
  );
  return {
    profile: { client_name: profile.client_name },
    cards: rows
  };
}

async function externalGetCard(token, cardId) {
  const profile = await getClientProfileByToken(token);
  const { rows } = await pool.query(
    `SELECT k.id, k.title, k.week, k.due_date, k.copy_text
       FROM kanban.card k
      WHERE k.id = $1
        AND k.id_customer = $2
      LIMIT 1`,
    [cardId, profile.id_customer]
  );
  if (!rows.length) throw new Error('Card não encontrado para este cliente.');

  const comments = await pool.query(
    `SELECT id, actor_type, author, body, created_at
       FROM kanban.card_comment
      WHERE card_id = $1
      ORDER BY created_at ASC`,
    [cardId]
  );

  return {
    profile: { client_name: profile.client_name },
    card: {
      ...rows[0],
      client_comments: comments.rows.map((r) => ({
        id: r.id,
        actor_type: r.actor_type,
        author: r.author,
        text: r.body,
        created_at: r.created_at
      }))
    }
  };
}

module.exports = {
  listBoardData,
  listTeam,
  listClientsWithProfile,
  upsertClientProfile,
  deleteClientProfile,
  getOrCreateClientPortalToken,
  getClientProfileByToken,
  listLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  listColumns,
  createColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
  listCardsAll,
  getCardByIdExpanded,
  createCard,
  updateCard,
  deleteCard,
  moveCard,
  addComment,
  listComments,
  listExternalCards,
  externalGetCard
};
