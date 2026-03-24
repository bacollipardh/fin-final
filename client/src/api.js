// api.js — with auto refresh token + 401 redirect
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8081";
const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

let _refreshing = false;
let _queue = [];

api.interceptors.response.use(
  r => r,
  async err => {
    const orig = err.config;
    if (err.response?.status === 401 && !orig._retry) {
      const errData = err.response?.data?.error;
      if (errData === "token_expired") {
        if (_refreshing) {
          return new Promise((res, rej) => {
            _queue.push({ res, rej });
          }).then(token => { orig.headers.Authorization = `Bearer ${token}`; return api(orig); });
        }
        orig._retry = true;
        _refreshing = true;
        const refresh_token = localStorage.getItem("refresh_token");
        if (!refresh_token) { _refreshing = false; _redirectLogin(); return Promise.reject(err); }
        try {
          const { data } = await axios.post(`${API_URL}/auth/refresh`, { refresh_token });
          localStorage.setItem("token", data.token);
          _queue.forEach(p => p.res(data.token));
          _queue = [];
          orig.headers.Authorization = `Bearer ${data.token}`;
          return api(orig);
        } catch {
          _queue.forEach(p => p.rej(err));
          _queue = [];
          _redirectLogin();
          return Promise.reject(err);
        } finally { _refreshing = false; }
      }
      _redirectLogin();
    }
    return Promise.reject(err);
  }
);

function _redirectLogin() {
  localStorage.clear();
  if (!location.pathname.includes("/login") && !location.pathname.includes("/reset-password")) {
    location.href = "/login";
  }
}

export default api;
