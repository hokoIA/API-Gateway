const { pool } = require('../config/db');
const { getJwtClearCookieOptions } = require('../config/security');

async function ensurePermissions(req, res, next) {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Nao autenticado.' });
    return false;
  }

  if (req.user.role === 'Admin') {
    req.user.permissions = ['*'];
    if (typeof next === 'function') {
      next();
      return;
    }
    return true;
  }

  if (Array.isArray(req.user.permissions) && req.user.permissions.length > 0) {
    if (typeof next === 'function') {
      next();
      return;
    }
    return true;
  }

  const { id_team_member, id_account, id } = req.user;
  if (!id_team_member || !id_account || !id) {
    res.clearCookie('jwt', getJwtClearCookieOptions(req));
    res.status(401).json({ success: false, message: 'Token invalido. Faca login novamente.' });
    return false;
  }

  try {
    const result = await pool.query(
      `
      SELECT p.code
      FROM team_members tm
      JOIN member_roles mr ON mr.id_team_member = tm.id_team_member
      JOIN roles r ON r.id_role = mr.id_role
      JOIN role_permissions rp ON rp.id_role = r.id_role
      JOIN permissions p ON p.id_permission = rp.id_permission
      WHERE tm.id_team_member = $1
        AND tm.id_account = $2
        AND tm.id_user = $3
        AND tm.status = 'active'
      `,
      [id_team_member, id_account, id]
    );

    req.user.permissions = result.rows.map(r => r.code);
    if (typeof next === 'function') {
      next();
      return;
    }
    return true;
  } catch (err) {
    console.error('RBAC ensurePermissions error:', err);
    res.status(500).json({ success: false, message: 'Erro ao carregar permissoes.' });
    return false;
  }
}

function requirePermission(permissionCode) {
  return async (req, res, next) => {
    const ok = await ensurePermissions(req, res);
    if (!ok) return;

    if (req.user.role === 'Admin') return next();

    const perms = req.user.permissions || [];
    if (perms.includes(permissionCode) || perms.includes('*')) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Acesso negado. Permissao insuficiente.',
      required: permissionCode
    });
  };
}

module.exports = {
  ensurePermissions,
  requirePermission
};
