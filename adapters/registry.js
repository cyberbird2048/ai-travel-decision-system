/*
 * 适配器注册中心：所有外部接口按需接入。
 * 每个适配器声明 id / label / keyRequired，可在设置面板配置 API Key（存 localStorage）。
 * 没有配置 Key 的适配器自动降级到内置示例数据或免 Key 公共接口。
 */
(function () {
  const KEY_PREFIX = "travel-planner:key:";
  const adapters = new Map();

  function register(def) {
    adapters.set(def.id, def);
  }

  function get(id) {
    return adapters.get(id);
  }

  function list() {
    return Array.from(adapters.values());
  }

  function getKey(id) {
    try {
      return localStorage.getItem(KEY_PREFIX + id) || "";
    } catch (e) {
      return "";
    }
  }

  function setKey(id, value) {
    try {
      if (value) localStorage.setItem(KEY_PREFIX + id, value);
      else localStorage.removeItem(KEY_PREFIX + id);
    } catch (e) {
      /* 私密模式下忽略 */
    }
  }

  function status(id) {
    const def = adapters.get(id);
    if (!def) return "missing";
    if (!def.keyRequired) return "live";
    return getKey(id) ? "live" : "sample";
  }

  window.AdapterRegistry = { register, get, list, getKey, setKey, status };
})();
