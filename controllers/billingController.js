// controllers/billingController.js
const { pool } = require('../config/db');
const { createCheckoutSession, createBillingPortalSession } = require('../services/stripeService');

async function getBillingOwnerByAccount(id_account) {
    const { rows } = await pool.query(`
        SELECT u.id_user, u.name, u.email, u.stripe_customer_id,
               u.plan_code, u.stripe_subscription_id, u.subscription_status,
               u.current_period_start, u.current_period_end,
               u.trial_start, u.trial_end, u.cancel_at, u.cancel_at_period_end
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
    `, [id_account]);

    return rows[0] || null;
}

// GET /api/billing/plans
exports.listPlans = async (req, res) => {
    try {
        const { rows } = await pool.query(`
        SELECT code, name, amount_cents, currency, interval, stripe_price_id
        FROM plans
        WHERE active = true
        ORDER BY amount_cents ASC
    `);
        res.json({ success: true, plans: rows });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'Erro ao listar planos' });
    }
};

// GET /api/billing/me
exports.getMySubscription = async (req, res) => {
    try {
        const owner = await getBillingOwnerByAccount(req.user.id_account);

        if (!owner) {
            return res.status(404).json({
                success: false,
                message: 'Conta administradora não encontrada para esta assinatura.'
            });
        }

        const hasSubscription =
            !!owner.stripe_subscription_id ||
            !!owner.subscription_status ||
            !!owner.plan_code;

        const normalizedStatus = owner.subscription_status || (hasSubscription ? 'unknown' : 'none');

        res.json({
            success: true,
            status: normalizedStatus,
            has_subscription: hasSubscription,
            subscription: hasSubscription
                ? {
                    id_user: owner.id_user,
                    plan_code: owner.plan_code,
                    stripe_subscription_id: owner.stripe_subscription_id,
                    subscription_status: normalizedStatus,
                    current_period_start: owner.current_period_start,
                    current_period_end: owner.current_period_end,
                    trial_start: owner.trial_start,
                    trial_end: owner.trial_end,
                    cancel_at: owner.cancel_at,
                    cancel_at_period_end: owner.cancel_at_period_end
                }
                : null
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'Erro ao buscar assinatura' });
    }
};

// POST /api/billing/checkout
exports.startCheckout = async (req, res) => {
    try {
        const { plan_code, promo_code } = req.body || {};

        let selectedPlanCode = plan_code;
        if (!selectedPlanCode) {
            const fallbackPlan = await pool.query(
                `
                SELECT code
                FROM plans
                WHERE active = true
                ORDER BY amount_cents ASC, created_at ASC
                LIMIT 1
                `
            );
            selectedPlanCode = fallbackPlan.rows[0]?.code || null;
        }

        if (!selectedPlanCode) {
            return res.status(400).json({
                success: false,
                message: 'Nenhum plano ativo disponível para checkout.'
            });
        }

        const user = await getBillingOwnerByAccount(req.user.id_account);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Conta administradora não encontrada para checkout.'
            });
        }

        // Preferir env STRIPE_PRICE_*; fallback: buscar price no banco por plan_code
        const envPrice = process.env[`STRIPE_PRICE_${selectedPlanCode.toUpperCase()}`];
        let priceId = envPrice;
        if (!priceId) {
            const q = await pool.query('SELECT stripe_price_id FROM plans WHERE code=$1 AND active=true', [selectedPlanCode]);
            priceId = q.rows[0]?.stripe_price_id;
        }
        if (!priceId) return res.status(400).json({ success: false, message: 'priceId do Stripe não encontrado' });

        const url = await createCheckoutSession({
            user,
            priceId,
            planCode: selectedPlanCode,
            promoCode: promo_code || null
        });
        res.json({ success: true, url });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'Erro ao criar Checkout Session' });
    }
};

// POST /api/billing/portal
exports.openBillingPortal = async (req, res) => {
    try {
        const user = await getBillingOwnerByAccount(req.user.id_account);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Conta administradora não encontrada para portal de cobrança.'
            });
        }
        const url = await createBillingPortalSession({ user });
        res.json({ success: true, url });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'Erro ao criar Billing Portal Session' });
    }
};
