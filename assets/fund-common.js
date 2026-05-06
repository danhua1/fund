(function () {
  var apiBase = "https://fundgz.1234567.com.cn/js/";
  var historyKey = "fund_recent_history_v1";
  var groupsKey = "fund_groups_v1";
  var historyLimit = 10;
  var groupLimit = 10;
  var activeScript = null;
  var activeTimeoutId = null;
  var pendingResolve = null;
  var pendingReject = null;

  function readJson(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) {
        return fallback;
      }
      var parsed = JSON.parse(raw);
      return parsed;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function normalizeFundCode(value) {
    var code = String(value || "").replace(/\D/g, "").slice(0, 6);
    return /^\d{6}$/.test(code) ? code : "";
  }

  function formatRate(value) {
    var num = Number(value);
    if (!isFinite(num)) {
      return "--";
    }
    return (num > 0 ? "+" : "") + num.toFixed(2) + "%";
  }

  function getTrendClass(rateValue) {
    var num = Number(rateValue);
    if (num > 0) {
      return "rise";
    }
    if (num < 0) {
      return "fall";
    }
    return "neutral";
  }

  function getTrendTextClass(rateValue) {
    var num = Number(rateValue);
    if (num > 0) {
      return "rise-text";
    }
    if (num < 0) {
      return "fall-text";
    }
    return "neutral-text";
  }

  function cleanupPending() {
    if (activeTimeoutId) {
      clearTimeout(activeTimeoutId);
      activeTimeoutId = null;
    }
    if (activeScript && activeScript.parentNode) {
      activeScript.parentNode.removeChild(activeScript);
    }
    activeScript = null;
    pendingResolve = null;
    pendingReject = null;
  }

  window.jsonpgz = function (payload) {
    if (typeof pendingResolve === "function") {
      var resolve = pendingResolve;
      cleanupPending();
      resolve(payload || {});
    }
  };

  function fetchFundInfo(code) {
    var normalizedCode = normalizeFundCode(code);
    if (!normalizedCode) {
      return Promise.reject(new Error("请输入 6 位基金代码"));
    }

    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");

      if (typeof pendingReject === "function") {
        pendingReject(new Error("上一次请求已取消"));
      }
      cleanupPending();

      pendingResolve = resolve;
      pendingReject = reject;
      activeScript = script;

      activeTimeoutId = window.setTimeout(function () {
        cleanupPending();
        reject(new Error("请求超时，请稍后重试"));
      }, 12000);

      script.onerror = function () {
        cleanupPending();
        reject(new Error("接口加载失败，请检查网络或基金代码"));
      };

      script.src = apiBase + encodeURIComponent(normalizedCode) + ".js?rt=" + Date.now();
      document.body.appendChild(script);
    });
  }

  function readRecentHistory() {
    var history = readJson(historyKey, []);
    return Array.isArray(history) ? history : [];
  }

  function saveRecentFund(data) {
    if (!data || !data.fundcode) {
      return;
    }

    var history = readRecentHistory().filter(function (item) {
      return item.fundcode !== data.fundcode;
    });

    history.unshift({
      fundcode: data.fundcode,
      name: data.name || "",
      gsz: data.gsz || "",
      gszzl: data.gszzl || "",
      viewedAt: data.gztime || new Date().toLocaleString()
    });

    writeJson(historyKey, history.slice(0, historyLimit));
  }

  function clearRecentHistory() {
    writeJson(historyKey, []);
  }

  function readGroups() {
    var groups = readJson(groupsKey, []);
    if (!Array.isArray(groups)) {
      return [];
    }
    return groups.map(function (group) {
      return {
        id: group.id,
        name: String(group.name || "").trim(),
        funds: Array.isArray(group.funds) ? group.funds.filter(function (code) {
          return /^\d{6}$/.test(String(code || ""));
        }) : []
      };
    }).filter(function (group) {
      return group.id && group.name;
    });
  }

  function writeGroups(groups) {
    return writeJson(groupsKey, groups);
  }

  function getGroupById(groupId) {
    var groups = readGroups();
    for (var index = 0; index < groups.length; index += 1) {
      if (groups[index].id === groupId) {
        return groups[index];
      }
    }
    return null;
  }

  function createGroup(name) {
    var trimmed = String(name || "").trim();
    if (!trimmed) {
      return { ok: false, message: "请输入分组名称" };
    }

    var groups = readGroups();
    var duplicate = groups.some(function (group) {
      return group.name === trimmed;
    });
    if (duplicate) {
      return { ok: false, message: "分组名称已存在，请换一个名称" };
    }

    groups.unshift({
      id: "group_" + Date.now() + "_" + Math.floor(Math.random() * 10000),
      name: trimmed,
      funds: []
    });
    writeGroups(groups);
    return { ok: true };
  }

  function deleteGroup(groupId) {
    var groups = readGroups().filter(function (group) {
      return group.id !== groupId;
    });
    writeGroups(groups);
  }

  function addFundToGroup(groupId, code) {
    var normalizedCode = normalizeFundCode(code);
    if (!normalizedCode) {
      return { ok: false, message: "请输入 6 位基金代码" };
    }

    var groups = readGroups();
    for (var index = 0; index < groups.length; index += 1) {
      if (groups[index].id !== groupId) {
        continue;
      }

      if (groups[index].funds.indexOf(normalizedCode) !== -1) {
        return { ok: false, message: "该基金代码已在当前分组中" };
      }

      if (groups[index].funds.length >= groupLimit) {
        return { ok: false, message: "单个分组最多只能保存 10 只基金" };
      }

      groups[index].funds.push(normalizedCode);
      writeGroups(groups);
      return { ok: true };
    }

    return { ok: false, message: "分组不存在" };
  }

  function removeFundFromGroup(groupId, code) {
    var groups = readGroups();
    for (var index = 0; index < groups.length; index += 1) {
      if (groups[index].id !== groupId) {
        continue;
      }
      groups[index].funds = groups[index].funds.filter(function (item) {
        return item !== code;
      });
      writeGroups(groups);
      return { ok: true };
    }
    return { ok: false, message: "分组不存在" };
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  window.FundApp = {
    addFundToGroup: addFundToGroup,
    clearRecentHistory: clearRecentHistory,
    createGroup: createGroup,
    delay: delay,
    deleteGroup: deleteGroup,
    fetchFundInfo: fetchFundInfo,
    formatRate: formatRate,
    getGroupById: getGroupById,
    getTrendClass: getTrendClass,
    getTrendTextClass: getTrendTextClass,
    normalizeFundCode: normalizeFundCode,
    readGroups: readGroups,
    readRecentHistory: readRecentHistory,
    removeFundFromGroup: removeFundFromGroup,
    saveRecentFund: saveRecentFund
  };
})();
