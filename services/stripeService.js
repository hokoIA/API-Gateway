// services/stripeService.js
const { stripe } = require('../config/stripeConfig');
const { pool } = require('../config/db'); // :contentReference[oaicite:7]{index=7}
const { FRONTEND_PATHS, buildFrontendUrl } = require('../config/urls');

const EXTRA_PRICE_ID = process.env.STRIPE_PRICE_CLIENT_EXTRA || null;

async function createBillingPortalSession({ user }) {
    const customerId = await ensureStripeCustomer(user);
    const configId = process.env.STRIPE_PORTAL_CONFIGURATION_ID || null;
    const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: buildFrontendUrl(FRONTEND_PATHS.settingsBilling),
        ...(configId ? { configuration: configId } : {})
    }); // :contentReference[oaicite:12]{index=12}
    return session.url;
}

async function createCheckoutSession({ user, priceId, planCode, promoCode }) {
    const customerId = await ensureStripeCustomer(user);

    // item base do plano (Pro/Starter)
    const lineItems = [{ price: priceId, quantity: 1 }];

    // item de cliente extra: só adiciona se houver extras no momento da compra
    const extrasQty = 0; // por enquanto não cobra extras no checkout inicial
    if (EXTRA_PRICE_ID && extrasQty >= 1) lineItems.push({ price: EXTRA_PRICE_ID, quantity: extrasQty });


    const params = {
        mode: 'subscription',
        customer: customerId,
        line_items: lineItems,
        subscription_data: {
            trial_period_days: 30,
            metadata: {
                plan_code: planCode,
                app_user_id: String(user.id_user)
            }
        },
        metadata: {
            plan_code: planCode,
            app_user_id: String(user.id_user)
        },
        allow_promotion_codes: true,
        success_url: buildFrontendUrl(FRONTEND_PATHS.settingsBilling, { checkout: 'success' }),
        cancel_url: buildFrontendUrl(FRONTEND_PATHS.settingsBilling, { checkout: 'cancel' }),
    };

    if (promoCode) {
        const found = await stripe.promotionCodes.list({ code: promoCode, limit: 1 });
        if (found.data[0]) params.discounts = [{ promotion_code: found.data[0].id }];

    }

    const session = await stripe.checkout.sessions.create(params);
    return session.url;
}

async function ensureStripeCustomer(user) {
    // se já tem, retorna
    if (user.stripe_customer_id) return user.stripe_customer_id;

    const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { app_user_id: String(user.id_user) },
    });
    await pool.query(
        'UPDATE "user" SET stripe_customer_id = $1 WHERE id_user = $2',
        [customer.id, user.id_user]
    );
    return customer.id;
}

// Recalcula quantidade de clientes extras (acima de 3) e atualiza item extra na assinatura.
// Por padrão, só aumenta quantidade. Redução fica para job/Lambda chamando com allowDecrease=true.
async function syncExtraClientsForUser(id_user, { allowDecrease = false } = {}) {
    console.log('[SYNC_EXTRAS] start', { id_user, allowDecrease, hasExtraPrice: !!EXTRA_PRICE_ID });

    if (!EXTRA_PRICE_ID) {
        console.log('[SYNC_EXTRAS] exit: EXTRA_PRICE_ID missing');
        return;
    }

    const { rows: rowsCount } = await pool.query(
        `SELECT COUNT(*) AS total 
       FROM customer 
      WHERE id_user = $1 
        AND status = 'active'`,
        [id_user]
    );

    const totalActive = Number(rowsCount[0]?.total || 0);
    const extrasWanted = Math.max(totalActive - 3, 0);

    console.log('[SYNC_EXTRAS] counted', { totalActive, extrasWanted });

    const { rows } = await pool.query(
        `SELECT stripe_subscription_id, stripe_extra_item_id 
       FROM "user" 
      WHERE id_user = $1`,
        [id_user]
    );

    if (!rows[0]) {
        console.log('[SYNC_EXTRAS] exit: user not found in DB');
        return;
    }

    const { stripe_subscription_id, stripe_extra_item_id } = rows[0];

    if (!stripe_subscription_id) {
        console.log('[SYNC_EXTRAS] exit: missing stripe_subscription_id');
        return;
    }

    let sub;
    try {
        sub = await stripe.subscriptions.retrieve(stripe_subscription_id);
    } catch (err) {
        console.log('[SYNC_EXTRAS] exit: stripe.subscriptions.retrieve failed', {
            message: err?.message,
            type: err?.type,
            code: err?.code
        });
        throw err;
    }

    const items = sub.items?.data || [];

    console.log('[SYNC_EXTRAS] subscription items', {
        itemsCount: items.length,
        itemIds: items.map(i => i.id),
        priceIds: items.map(i => i.price?.id),
        quantities: items.map(i => i.quantity)
    });

    let extraItem = null;

    if (stripe_extra_item_id) {
        extraItem = items.find(i => i.id === stripe_extra_item_id) || null;
    }

    if (!extraItem) {
        extraItem = items.find(i => i.price?.id === EXTRA_PRICE_ID) || null;

        if (extraItem) {
            await pool.query(
                `UPDATE "user" SET stripe_extra_item_id = $1 WHERE id_user = $2`,
                [extraItem.id, id_user]
            );
            console.log('[SYNC_EXTRAS] saved stripe_extra_item_id from subscription', { extraItemId: extraItem.id });
        }
    }

    if (!extraItem) {
        if (extrasWanted <= 0) {
            console.log('[SYNC_EXTRAS] exit: no extra needed and no extra item exists');
            return;
        }

        console.log('[SYNC_EXTRAS] creating extra item', { extrasWanted });

        let created;
        try {
            created = await stripe.subscriptionItems.create({
                subscription: stripe_subscription_id,
                price: EXTRA_PRICE_ID,
                quantity: extrasWanted
            });
        } catch (err) {
            console.log('[SYNC_EXTRAS] create extra item failed', {
                message: err?.message,
                type: err?.type,
                code: err?.code
            });
            throw err;
        }

        await pool.query(
            `UPDATE "user" SET stripe_extra_item_id = $1 WHERE id_user = $2`,
            [created.id, id_user]
        );

        console.log('[SYNC_EXTRAS] created extra item and saved', { extraItemId: created.id });
        return;
    }

    const currentQty = extraItem.quantity || 0;

    if (extrasWanted === currentQty) {
        console.log('[SYNC_EXTRAS] exit: no change needed');
        return;
    }

    if (extrasWanted < currentQty && !allowDecrease) {
        console.log('[SYNC_EXTRAS] exit: decrease blocked by rule', { currentQty, extrasWanted });
        return;
    }

    const proration_behavior = extrasWanted > currentQty ? 'create_prorations' : 'none';

    console.log('[SYNC_EXTRAS] updating subscription', {
        stripe_subscription_id,
        stripe_extra_item_id: extraItem.id,
        extrasWanted,
        proration_behavior
    });

    let updated;
    try {
        updated = await stripe.subscriptions.update(stripe_subscription_id, {
            items: [{ id: extraItem.id, quantity: extrasWanted }],
            proration_behavior
        });
    } catch (err) {
        console.log('[SYNC_EXTRAS] update failed', {
            message: err?.message,
            type: err?.type,
            code: err?.code
        });
        throw err;
    }

    const updatedExtra = (updated.items?.data || []).find(i => i.id === extraItem.id);
    console.log('[SYNC_EXTRAS] update ok', { updatedQty: updatedExtra?.quantity ?? null });
}

module.exports = { ensureStripeCustomer, createBillingPortalSession, createCheckoutSession, syncExtraClientsForUser };
