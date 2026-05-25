// Arquivo: controllers/teamController.js

const crypto = require('crypto');
const { pool } = require('../config/db');
const transporter = require('../config/mailerConfig');
const { FRONTEND_PATHS, buildFrontendUrl } = require('../config/urls');

async function getRoleIdByName(id_account, roleName) {
  const r = await pool.query(
    `SELECT id_role FROM roles WHERE id_account = $1 AND lower(name) = lower($2) LIMIT 1`,
    [id_account, roleName]
  );
  return r.rows[0]?.id_role || null;
}

exports.listMembers = async (req, res) => {
  try {
    const { id_account } = req.user;

    const result = await pool.query(
      `
      SELECT
        tm.id_team_member,
        tm.status,
        tm.invited_at,
        tm.joined_at,
        tm.disabled_at,
        u.id_user,
        u.name,
        u.email,
        r.name AS role
      FROM team_members tm
      JOIN "user" u ON u.id_user = tm.id_user
      JOIN member_roles mr ON mr.id_team_member = tm.id_team_member
      JOIN roles r ON r.id_role = mr.id_role
      WHERE tm.id_account = $1
      ORDER BY tm.created_at DESC
      `,
      [id_account]
    );

    return res.json({ success: true, members: result.rows });
  } catch (err) {
    console.error('teamController.listMembers error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao listar membros.' });
  }
};

exports.listInvites = async (req, res) => {
  try {
    const { id_account } = req.user;

    const result = await pool.query(
      `
      SELECT
        id_invite,
        email,
        expires_at,
        accepted_at,
        created_at,
        created_by_user_id
      FROM invites
      WHERE id_account = $1
      ORDER BY created_at DESC
      `,
      [id_account]
    );

    return res.json({ success: true, invites: result.rows });
  } catch (err) {
    console.error('teamController.listInvites error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao listar convites.' });
  }
};

exports.inviteMember = async (req, res) => {
  try {
    const { id_account, id: id_user } = req.user;
    const { email } = req.body;

    if (!email || typeof email !== 'string') return res.status(400).json({ success: false, message: 'Email é obrigatório.' });

    const normalizedEmail = email.trim().toLowerCase();

    // Regra atual: um "user" pertence a exatamente 1 account.
    // Se já existir usuário com esse email, bloqueia convite.
    const existingUser = await pool.query(
      `SELECT id_user, id_account FROM "user" WHERE lower(email) = $1 LIMIT 1`,
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      const row = existingUser.rows[0];
      if (Number(row.id_account) !== Number(id_account)) {
        return res.status(409).json({
          success: false,
          message: 'Este email já está cadastrado em outra conta. Não é possível convidar.'
        });
      }

      const alreadyMember = await pool.query(
        `SELECT 1 FROM team_members WHERE id_account = $1 AND id_user = $2 LIMIT 1`,
        [id_account, row.id_user]
      );

      if (alreadyMember.rows.length > 0) {
        return res.status(410).json({
          success: false,
          message: 'Este usuário já faz parte da equipe desta conta.'
        });
      }

      return res.status(411).json({
        success: false,
        message: 'Usuário já existe nesta conta, mas não está vinculado como membro. Verifique a migração.'
      });
    }

    // Evitar múltiplos convites ativos
    const existingInvite = await pool.query(
      `
      SELECT id_invite
      FROM invites
      WHERE id_account = $1
        AND lower(email) = $2
        AND accepted_at IS NULL
        AND expires_at > now()
      LIMIT 1
      `,
      [id_account, normalizedEmail]
    );

    if (existingInvite.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Já existe um convite ativo para este email.'
      });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const insert = await pool.query(
      `
      INSERT INTO invites (id_account, email, token_hash, expires_at, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id_invite, email, expires_at, created_at
      `,
      [id_account, normalizedEmail, tokenHash, expiresAt, id_user]
    );

    const inviteLink = buildFrontendUrl(FRONTEND_PATHS.acceptInvite, { token: rawToken });

    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: normalizedEmail,
      subject: 'Convite para acessar a plataforma',
      html: `
        <p>Você foi convidado(a) para acessar a plataforma.</p>
        <p>Clique no link abaixo para criar sua senha e ativar seu acesso:</p>
        <p><a href="${inviteLink}">Ativar acesso</a></p>
        <p>Este link expira em 48 horas.</p>
      `
    });

    return res.status(201).json({ success: true, invite: insert.rows[0] });
  } catch (err) {
    console.error('teamController.inviteMember error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao criar convite.' });
  }
};

exports.resendInvite = async (req, res) => {
  try {
    const { id_account, id: id_user } = req.user;
    const { id_invite } = req.params;

    const inv = await pool.query(
      `
      SELECT id_invite, email, accepted_at
      FROM invites
      WHERE id_invite = $1 AND id_account = $2
      LIMIT 1
      `,
      [id_invite, id_account]
    );

    if (inv.rows.length === 0) return res.status(404).json({ success: false, message: 'Convite não encontrado.' });

    if (inv.rows[0].accepted_at) return res.status(409).json({ success: false, message: 'Convite já foi aceito.' });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await pool.query(
      `
      UPDATE invites
      SET token_hash = $1,
          expires_at = $2,
          created_by_user_id = $3,
          created_at = now()
      WHERE id_invite = $4 AND id_account = $5
      `,
      [tokenHash, expiresAt, id_user, id_invite, id_account]
    );

    const inviteLink = buildFrontendUrl(FRONTEND_PATHS.acceptInvite, { token: rawToken });

    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: inv.rows[0].email,
      subject: 'Reenvio de convite - Acesso à plataforma',
      html: `
        <p>Segue o link atualizado para ativar seu acesso:</p>
        <p><a href="${inviteLink}">Ativar acesso</a></p>
        <p>Este link expira em 48 horas.</p>
      `
    });

    return res.json({ success: true, message: 'Convite reenviado.' });
  } catch (err) {
    console.error('teamController.resendInvite error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao reenviar convite.' });
  }
};

exports.cancelInvite = async (req, res) => {
  try {
    const { id_account } = req.user;
    const { id_invite } = req.params;

    const del = await pool.query(
      `DELETE FROM invites WHERE id_invite = $1 AND id_account = $2 AND accepted_at IS NULL`,
      [id_invite, id_account]
    );

    if (del.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Convite não encontrado ou já aceito.' });
    }

    return res.json({ success: true, message: 'Convite cancelado.' });
  } catch (err) {
    console.error('teamController.cancelInvite error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao cancelar convite.' });
  }
};

exports.disableMember = async (req, res) => {
  try {
    const { id_account, id: myUserId } = req.user;
    const { id_team_member } = req.params;

    const target = await pool.query(
      `
      SELECT tm.id_team_member, tm.id_user, r.name AS role
      FROM team_members tm
      JOIN member_roles mr ON mr.id_team_member = tm.id_team_member
      JOIN roles r ON r.id_role = mr.id_role
      WHERE tm.id_team_member = $1 AND tm.id_account = $2
      LIMIT 1
      `,
      [id_team_member, id_account]
    );

    if (target.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Membro não encontrado.' });
    }

    if (Number(target.rows[0].id_user) === Number(myUserId) && String(target.rows[0].role).toLowerCase() === 'admin') {
      return res.status(409).json({ success: false, message: 'Você não pode desativar seu próprio acesso Admin.' });
    }

    await pool.query(
      `
      UPDATE team_members
      SET status = 'disabled', disabled_at = now()
      WHERE id_team_member = $1 AND id_account = $2
      `,
      [id_team_member, id_account]
    );

    return res.json({ success: true, message: 'Membro desativado.' });
  } catch (err) {
    console.error('teamController.disableMember error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao desativar membro.' });
  }
};

exports.updateMemberRole = async (req, res) => {
  try {
    const { id_account, id: myUserId } = req.user;
    const { id_team_member } = req.params;
    const { role } = req.body;

    if (!role || typeof role !== 'string') return res.status(400).json({ success: false, message: 'Role é obrigatório.' });

    const roleName = role.trim();
    if (!['Admin', 'Equipe', 'admin', 'equipe'].includes(roleName)) return res.status(400).json({ success: false, message: 'Role inválido. Use Admin ou Equipe.' });
    
    const target = await pool.query(
      `
      SELECT tm.id_team_member, tm.id_user, r.name AS current_role
      FROM team_members tm
      JOIN member_roles mr ON mr.id_team_member = tm.id_team_member
      JOIN roles r ON r.id_role = mr.id_role
      WHERE tm.id_team_member = $1 AND tm.id_account = $2
      LIMIT 1
      `,
      [id_team_member, id_account]
    );

    if (target.rows.length === 0) return res.status(404).json({ success: false, message: 'Membro não encontrado.' });

    if (
      Number(target.rows[0].id_user) === Number(myUserId) &&
      String(target.rows[0].current_role).toLowerCase() === 'admin' &&
      roleName.toLowerCase() !== 'admin'
    ) {
      return res.status(409).json({ success: false, message: 'Você não pode remover seu próprio papel de Admin.' });
    }

    const newRoleId = await getRoleIdByName(id_account, roleName);
    if (!newRoleId) return res.status(404).json({ success: false, message: 'Role não encontrado nesta conta.' });

    await pool.query(
      `UPDATE member_roles SET id_role = $1 WHERE id_team_member = $2`,
      [newRoleId, id_team_member]
    );

    return res.json({ success: true, message: 'Role atualizado.' });
  } catch (err) {
    console.error('teamController.updateMemberRole error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao atualizar role do membro.' });
  }
};
