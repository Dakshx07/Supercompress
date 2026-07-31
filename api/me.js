const { json } = require("./_lib/http");
const { verifyUser } = require("./_lib/auth");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "GET") return json(res, 405, { detail: "Method not allowed" });
  try {
    const user = await verifyUser(req);
    return json(res, 200, { uid: user.uid, email: user.email });
  } catch (err) {
    return json(res, err.status || 401, { detail: err.message });
  }
};
