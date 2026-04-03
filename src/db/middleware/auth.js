const jwt = require('jsonwebtoken');
const db = require('..');

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Niste prijavljeni.' });
    }
    const token = header.split(' ')[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.queryOne(
      'SELECT id, email, name, role FROM users WHERE id = $1',
      [payload.userId]
    );
    if (!user) return res.status(401).json({ error: 'Korisnik ne postoji.' });
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesija je istekla. Prijavite se ponovo.' });
    }
    return res.status(401).json({ error: 'Nevažeći token.' });
  }
};

const requireBusiness = async (req, res, next) => {
  try {
    const businessId = req.params.businessId || req.body.businessId;
    if (!businessId) return res.status(400).json({ error: 'Nedostaje businessId.' });
    const business = await db.queryOne(
      `SELECT b.*, s.plan, s.status AS sub_status, s.ai_queries_used, s.ai_queries_limit
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       WHERE b.id = $1 AND b.owner_id = $2`,
      [businessId, req.user.id]
    );
    if (!business) {
      return res.status(403).json({ error: 'Nemate pristup ovom biznisu.' });
    }
    req.business = business;
    next();
  } catch (err) {
    next(err);
  }
};

const requirePlan = (minPlan) => (req, res, next) => {
  const plans = { starter: 1, pro: 2, business: 3 };
  const userPlan = req.business?.plan || 'starter';
  if ((plans[userPlan] || 0) < plans[minPlan]) {
    return res.status(402).json({
      error: `Ova funkcija zahtijeva ${minPlan.toUpperCase()} plan.`,
      upgrade_required: true,
      required_plan: minPlan,
    });
  }
  next();
};

const checkAIQuota = async (req, res, next) => {
  const { plan, ai_queries_used, ai_queries_limit } = req.business;
  if (plan === 'business') return next();
  if (ai_queries_used >= ai_queries_limit) {
    return res.status(402).json({
      error: `Iskoristili ste svih ${ai_queries_limit} AI upita ovog mjeseca.`,
      upgrade_required: true,
    });
  }
  next();
};

module.exports = { authenticate, requireBusiness, requirePlan, checkAIQuota };