// Arquivo: helpers/keyHelper.js
const { getCustomerKeys, checkCustomerBelongsToUser } = require('../repositories/customerRepository');
const { getUserKeys } = require('../repositories/userRepository');

const cache = new Map();

const refreshKeysForCustomer = async (id_user, id_customer) => {
  const belongs = await checkCustomerBelongsToUser(id_customer, id_user);
  if (!belongs) throw new Error('Cliente não pertence ao usuário autenticado.'); 

  const customerKeys = await getCustomerKeys(id_customer);
  const userKeys = await getUserKeys(id_user);

  const composed = {
    facebook: {
      page_id: customerKeys.facebook_page_id,
      access_token: userKeys.facebook_access_token
    },
    instagram: {
      page_id: customerKeys.instagram_page_id,
      access_token: userKeys.instagram_access_token
    }
  };

  const cacheKey = `${id_user}:${id_customer}`;
  cache.set(cacheKey, {
    data: composed,
    expires: Date.now() + 1000 * 60 * 5
  });

  return composed;
};

const getAllKeys = async (id_user, id_customer) => {
  const cacheKey = `${id_user}:${id_customer}`;

  if (cache.has(cacheKey)) {
    const { expires, data } = cache.get(cacheKey);
    if (Date.now() < expires) return data;
    cache.delete(cacheKey);
  }

  return await refreshKeysForCustomer(id_user, id_customer);
};

function clearCacheForUser(id_user) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${id_user}:`)) {
      cache.delete(key);
    }
  }
}

module.exports = { getAllKeys, refreshKeysForCustomer, clearCacheForUser };