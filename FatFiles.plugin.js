/**
 * @name FatFiles
 * @author zyrexdz
 * @version 1.0.0
 * @description Uploads huge files past Discords 10MB limit to fast free hosts and drops direct links right into your chat.
 */

module.exports = class FatFiles {
    constructor(meta) {
        this.meta = meta || {
            name: "FatFiles",
            author: "zyrexdz",
            version: "1.0.0",
            description: "Uploads huge files past Discords 10MB limit to fast free hosts and drops direct links right into your chat."
        };

        this.defaultSettings = {
            uploadThresholdMB: 10,
            defaultHost: "auto",
            askBeforeUpload: true,
            enabledHosts: {
                tmpfiles: true,
                uguu: true,
                tempsh: true,
                x0: true,
                kappa: true,
                gofile: true,
                litterbox: true,
                catbox: true
            },
            litterboxExpiry: "72h",
            postingMode: "draft",
            smartMediaEmbeds: true,
            showFloatingWidget: true,
            pingTimeoutMs: 2000
        };

        this.settings = Object.assign({}, this.defaultSettings);
        this.activeUploads = new Map();
        this.recentUploads = new Map();
        this.styleElementId = "fatfiles_styles";
        this.widgetContainerId = "fatfiles_dock";
        this.modalContainerId = "fatfiles_modal_root";

        this.handleGlobalDrop = this.handleGlobalDrop.bind(this);
    }

    getHosts() {
        return {
            tmpfiles: {
                id: "tmpfiles",
                name: "Tmpfiles.org",
                maxSize: 10 * 1024 * 1024 * 1024,
                retentionText: "24 Hours (Fast direct link)",
                method: "POST",
                uploadUrl: "https://tmpfiles.org/api/v1/upload",
                pingUrl: "https://tmpfiles.org",
                color: "#2ed573",
                prepareBody: (file) => {
                    const fd = new FormData();
                    fd.append("file", file, file.name);
                    return fd;
                },
                parseResponse: (responseText) => {
                    try {
                        const json = JSON.parse(responseText);
                        if (json.status === "success" && json.data && json.data.url) {
                            let rawUrl = json.data.url;
                            if (rawUrl.includes("tmpfiles.org/") && !rawUrl.includes("tmpfiles.org/dl/")) {
                                return rawUrl.replace("tmpfiles.org/", "tmpfiles.org/dl/");
                            }
                            return rawUrl;
                        }
                        if (responseText.startsWith("http")) return responseText.trim();
                        throw new Error(json.message || "Could not get upload link from Tmpfiles");
                    } catch (e) {
                        if (responseText.startsWith("http")) return responseText.trim();
                        throw new Error(`Tmpfiles error: ${e.message || responseText}`);
                    }
                }
            },
            uguu: {
                id: "uguu",
                name: "Uguu.se",
                maxSize: 100 * 1024 * 1024,
                retentionText: "3 Hours (Quick temporary link)",
                method: "POST",
                uploadUrl: "https://uguu.se/upload",
                pingUrl: "https://uguu.se",
                color: "#e056fd",
                prepareBody: (file) => {
                    const fd = new FormData();
                    fd.append("files[]", file, file.name);
                    return fd;
                },
                parseResponse: (responseText) => {
                    try {
                        const json = JSON.parse(responseText);
                        if (json.success && json.files && json.files[0] && json.files[0].url) {
                            return json.files[0].url;
                        }
                    } catch (e) {}
                    const url = responseText.trim();
                    if (url.startsWith("http://") || url.startsWith("https://")) {
                        return url;
                    }
                    throw new Error(`Uguu error: ${responseText}`);
                }
            },
            tempsh: {
                id: "tempsh",
                name: "Temp.sh",
                maxSize: 4 * 1024 * 1024 * 1024,
                retentionText: "3 Days (Up to 4GB)",
                method: "POST",
                uploadUrl: "https://temp.sh/upload",
                pingUrl: "https://temp.sh",
                color: "#1dd1a1",
                prepareBody: (file) => {
                    const fd = new FormData();
                    fd.append("file", file, file.name);
                    return fd;
                },
                parseResponse: (responseText) => {
                    const url = responseText.trim();
                    if (url.startsWith("http://") || url.startsWith("https://")) {
                        return url;
                    }
                    throw new Error(`Temp.sh error: ${responseText}`);
                }
            },
            x0: {
                id: "x0",
                name: "x0.at",
                maxSize: 512 * 1024 * 1024,
                retentionText: "30 to 365 Days",
                method: "POST",
                uploadUrl: "https://x0.at",
                pingUrl: "https://x0.at",
                color: "#00d2d3",
                prepareBody: (file) => {
                    const fd = new FormData();
                    fd.append("file", file, file.name);
                    return fd;
                },
                parseResponse: (responseText) => {
                    const url = responseText.trim();
                    if (url.startsWith("http://") || url.startsWith("https://")) {
                        return url;
                    }
                    throw new Error(`x0 error: ${responseText}`);
                }
            },
            kappa: {
                id: "kappa",
                name: "Kappa.lol",
                maxSize: 500 * 1024 * 1024,
                retentionText: "30+ Days (Direct stream link)",
                method: "POST",
                uploadUrl: "https://kappa.lol/api/upload",
                pingUrl: "https://kappa.lol",
                color: "#ff9f43",
                prepareBody: (file) => {
                    const fd = new FormData();
                    fd.append("file", file, file.name);
                    return fd;
                },
                parseResponse: (responseText) => {
                    try {
                        const json = JSON.parse(responseText);
                        if (json.link) return json.link;
                        if (json.id) {
                            const ext = json.ext || "";
                            return `https://kappa.lol/${json.id}${ext}`;
                        }
                    } catch (e) {}
                    if (responseText.startsWith("http")) return responseText.trim();
                    throw new Error(`Kappa error: ${responseText}`);
                }
            },
            gofile: {
                id: "gofile",
                name: "Gofile.io",
                maxSize: 10 * 1024 * 1024 * 1024,
                retentionText: "Active Cloud (Up to 10GB)",
                method: "POST",
                pingUrl: "https://api.gofile.io/servers",
                color: "#10ac84",
                getDynamicUploadUrl: async () => {
                    try {
                        const res = await fetch("https://api.gofile.io/servers");
                        const json = await res.json();
                        if (json.status === "ok" && json.data && json.data.servers && json.data.servers[0]) {
                            return `https://${json.data.servers[0].name}.gofile.io/contents/uploadfile`;
                        }
                    } catch (e) {}
                    return "https://upload.gofile.io/uploadfile";
                },
                prepareBody: (file) => {
                    const fd = new FormData();
                    fd.append("file", file, file.name);
                    return fd;
                },
                parseResponse: (responseText) => {
                    try {
                        const json = JSON.parse(responseText);
                        if (json.status === "ok" && json.data && json.data.downloadPage) {
                            return json.data.downloadPage;
                        }
                        throw new Error(json.message || "Gofile upload failed");
                    } catch (e) {
                        throw new Error(`Gofile error: ${e.message || responseText}`);
                    }
                }
            },
            litterbox: {
                id: "litterbox",
                name: "Litterbox",
                maxSize: 1024 * 1024 * 1024,
                retentionText: "72 Hours (Up to 1GB)",
                method: "POST",
                uploadUrl: "https://litterbox.catbox.moe/resources/internals/api.php",
                pingUrl: "https://litterbox.catbox.moe",
                color: "#70a1ff",
                prepareBody: (file, settings) => {
                    const fd = new FormData();
                    fd.append("reqtype", "fileupload");
                    fd.append("time", settings.litterboxExpiry || "72h");
                    fd.append("fileToUpload", file, file.name);
                    return fd;
                },
                parseResponse: (responseText) => {
                    const url = responseText.trim();
                    if (url.startsWith("http://") || url.startsWith("https://")) {
                        return url;
                    }
                    throw new Error(`Litterbox error: ${responseText}`);
                }
            },
            catbox: {
                id: "catbox",
                name: "Catbox.moe",
                maxSize: 200 * 1024 * 1024,
                retentionText: "Permanent (Up to 200MB)",
                method: "POST",
                uploadUrl: "https://catbox.moe/user/api.php",
                pingUrl: "https://catbox.moe",
                color: "#ff6b81",
                prepareBody: (file) => {
                    const fd = new FormData();
                    fd.append("reqtype", "fileupload");
                    fd.append("fileToUpload", file, file.name);
                    return fd;
                },
                parseResponse: (responseText) => {
                    const url = responseText.trim();
                    if (url.startsWith("http://") || url.startsWith("https://")) {
                        return url;
                    }
                    throw new Error(`Catbox error: ${responseText}`);
                }
            }
        };
    }

    start() {
        this.loadSettings();
        this.injectStyles();
        this.attachGlobalEventListeners();
        this.patchUploadPipeline();
    }

    stop() {
        this.cancelAllActiveUploads();
        this.detachGlobalEventListeners();
        try {
            BdApi.Patcher.unpatchAll(this.meta.name);
        } catch (e) {}
        this.removeStyles();
        this.removeFloatingWidget();
        this.removeModal();
    }

    loadSettings() {
        const saved = BdApi.Data.load(this.meta.name, "settings");
        if (saved) {
            this.settings = Object.assign({}, this.defaultSettings, saved);
            if (saved.enabledHosts) {
                this.settings.enabledHosts = Object.assign({}, this.defaultSettings.enabledHosts, saved.enabledHosts);
            }
        }
    }

    saveSettings() {
        BdApi.Data.save(this.meta.name, "settings", this.settings);
    }

    attachGlobalEventListeners() {
        window.addEventListener("drop", this.handleGlobalDrop, true);
    }

    detachGlobalEventListeners() {
        window.removeEventListener("drop", this.handleGlobalDrop, true);
    }

    safePatchInstead(target, method, callback) {
        try {
            if (!target || typeof target[method] !== "function") return;
            const desc = Object.getOwnPropertyDescriptor(target, method);
            if (desc && desc.writable === false && desc.configurable === false) return;
            BdApi.Patcher.instead(this.meta.name, target, method, callback);
        } catch (e) {}
    }

    handleGlobalDrop(e) {
        try {
            if (!e.dataTransfer || !e.dataTransfer.files) return;
            const files = Array.from(e.dataTransfer.files || []);
            if (files.length === 0) return;

            const threshold = (this.settings.uploadThresholdMB || 10) * 1024 * 1024;
            const largeFiles = files.filter(f => f && f.size > threshold);

            if (largeFiles.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                const channelId = this.getSelectedChannelId();
                this.handleIncomingFiles(largeFiles, channelId);

                const normalFiles = files.filter(f => f && f.size <= threshold);
                if (normalFiles.length > 0) {
                    const uploadMod = BdApi.Webpack.getByKeys("addFiles", "promptToUpload") || 
                                     BdApi.Webpack.getByKeys("addFiles");
                    if (uploadMod && typeof uploadMod.addFiles === "function") {
                        try {
                            uploadMod.addFiles({ files: normalFiles, channelId });
                        } catch (err) {}
                    }
                }
            }
        } catch (err) {}
    }

    getSelectedChannelId() {
        try {
            const SelectedChannelStore = BdApi.Webpack.getStore("SelectedChannelStore") ||
                                         BdApi.Webpack.getByKeys("getChannelId", "getVoiceChannelId");
            if (SelectedChannelStore && typeof SelectedChannelStore.getChannelId === "function") {
                return SelectedChannelStore.getChannelId();
            }
        } catch (e) {}
        return null;
    }

    async postResultToDiscord(channelId, text) {
        if (!channelId) {
            channelId = this.getSelectedChannelId();
        }

        if (this.settings.postingMode === "send" && channelId) {
            try {
                const MessageActions = BdApi.Webpack.getByKeys("sendMessage", "editMessage") || 
                                       BdApi.Webpack.getByKeys("sendMessage");
                if (MessageActions && typeof MessageActions.sendMessage === "function") {
                    await MessageActions.sendMessage(channelId, {
                        content: text,
                        invalidEmojis: [],
                        validNonShortcutEmojis: [],
                        tts: false
                    });
                    BdApi.UI.showToast("Sent your link right in chat!", { type: "success" });
                    return true;
                }
            } catch (err) {}
        }

        try {
            const ComponentDispatch = BdApi.Webpack.getByKeys("dispatchToLastSubscribed") || 
                                      BdApi.Webpack.getByKeys("ComponentDispatch");
            if (ComponentDispatch) {
                if (typeof ComponentDispatch.dispatchToLastSubscribed === "function") {
                    ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", {
                        plainText: text,
                        rawText: text
                    });
                    BdApi.UI.showToast("Pasted the link in your chat box!", { type: "success" });
                    return true;
                } else if (typeof ComponentDispatch.dispatch === "function") {
                    ComponentDispatch.dispatch("INSERT_TEXT", { content: text });
                    BdApi.UI.showToast("Pasted the link in your chat box!", { type: "success" });
                    return true;
                }
            }
        } catch (err) {}

        try {
            const DraftActions = BdApi.Webpack.getByKeys("saveDraft", "changeDraft") || 
                                 BdApi.Webpack.getByKeys("saveDraft");
            const DraftStore = BdApi.Webpack.getStore("DraftStore") || 
                               BdApi.Webpack.getByKeys("getDraft");
            if (DraftActions && channelId) {
                const currentDraft = DraftStore && typeof DraftStore.getDraft === "function" 
                    ? (DraftStore.getDraft(channelId, 0) || "") 
                    : "";
                const newDraft = currentDraft ? `${currentDraft}\n${text}` : text;
                DraftActions.saveDraft(channelId, newDraft, 0);
                BdApi.UI.showToast("Saved the link in your message draft!", { type: "success" });
                return true;
            }
        } catch (err) {}

        try {
            navigator.clipboard.writeText(text);
            BdApi.UI.showToast("Copied link to clipboard!", { type: "info" });
        } catch (e) {}

        return false;
    }

    patchUploadPipeline() {
        const self = this;

        const uploadMod = BdApi.Webpack.getByKeys("addFiles", "promptToUpload") ||
                          BdApi.Webpack.getByKeys("promptToUpload") ||
                          BdApi.Webpack.getByKeys("addFiles");

        if (!uploadMod) return;

        if (typeof uploadMod.promptToUpload === "function") {
            this.safePatchInstead(uploadMod, "promptToUpload", (thisObject, args, originalFunction) => {
                try {
                    const [rawFiles, channel] = args;
                    const channelId = channel?.id || (typeof channel === "string" ? channel : self.getSelectedChannelId());
                    const fileList = self.extractFiles(rawFiles);

                    if (!fileList || fileList.length === 0) {
                        return originalFunction.apply(thisObject, args);
                    }

                    const currentThreshold = (self.settings.uploadThresholdMB || 10) * 1024 * 1024;
                    const largeFiles = [];
                    const normalFiles = [];

                    for (const item of fileList) {
                        const fileObj = item.file || item.item?.file || item.originFile || item;
                        if (fileObj && fileObj.size > currentThreshold) {
                            largeFiles.push(fileObj);
                        } else {
                            normalFiles.push(item);
                        }
                    }

                    if (largeFiles.length > 0) {
                        self.handleIncomingFiles(largeFiles, channelId);

                        if (normalFiles.length > 0) {
                            const newArgs = [...args];
                            newArgs[0] = normalFiles;
                            return originalFunction.apply(thisObject, newArgs);
                        }

                        return;
                    }
                } catch (e) {}
                return originalFunction.apply(thisObject, args);
            });
        }

        if (typeof uploadMod.addFiles === "function") {
            this.safePatchInstead(uploadMod, "addFiles", (thisObject, args, originalFunction) => {
                try {
                    const param = args[0];
                    let rawFiles = [];
                    let channelId = null;

                    if (param && typeof param === "object") {
                        rawFiles = param.files || param.uploads || [];
                        channelId = param.channelId || self.getSelectedChannelId();
                    } else if (Array.isArray(param)) {
                        rawFiles = param;
                        channelId = args[1] || self.getSelectedChannelId();
                    }

                    const fileList = self.extractFiles(rawFiles);
                    if (!fileList || fileList.length === 0) {
                        return originalFunction.apply(thisObject, args);
                    }

                    const currentThreshold = (self.settings.uploadThresholdMB || 10) * 1024 * 1024;
                    const largeFiles = [];
                    const normalFiles = [];

                    for (const item of fileList) {
                        const fileObj = item.file || item.item?.file || item.originFile || item;
                        if (fileObj && fileObj.size > currentThreshold) {
                            largeFiles.push(fileObj);
                        } else {
                            normalFiles.push(item);
                        }
                    }

                    if (largeFiles.length > 0) {
                        self.handleIncomingFiles(largeFiles, channelId);

                        if (normalFiles.length > 0) {
                            if (param && typeof param === "object" && param.files) {
                                param.files = normalFiles;
                                return originalFunction.apply(thisObject, [param, ...args.slice(1)]);
                            } else {
                                args[0] = normalFiles;
                                return originalFunction.apply(thisObject, args);
                            }
                        }

                        return;
                    }
                } catch (e) {}
                return originalFunction.apply(thisObject, args);
            });
        }
    }

    extractFiles(rawFiles) {
        if (!rawFiles) return [];
        if (Array.isArray(rawFiles)) return rawFiles;
        if (rawFiles instanceof FileList) return Array.from(rawFiles);
        if (typeof rawFiles === "object") {
            if (rawFiles.files && Array.isArray(rawFiles.files)) return rawFiles.files;
            if (rawFiles.uploads && Array.isArray(rawFiles.uploads)) return rawFiles.uploads;
            if (rawFiles.file) return [rawFiles];
            if (rawFiles.size && rawFiles.name) return [rawFiles];
        }
        return [];
    }

    handleIncomingFiles(files, channelId) {
        for (const file of files) {
            const fileKey = `${file.name}_${file.size}_${file.lastModified || 0}`;
            const lastTime = this.recentUploads.get(fileKey);
            if (lastTime && (Date.now() - lastTime < 2500)) {
                continue;
            }
            this.recentUploads.set(fileKey, Date.now());

            if (this.settings.askBeforeUpload) {
                this.showPreUploadModal(file, channelId);
            } else {
                this.startFileUpload(file, channelId, null);
            }
        }
    }

    async pingHost(host, timeoutMs = 2000) {
        const start = performance.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            await fetch(host.pingUrl || host.uploadUrl, {
                method: "HEAD",
                mode: "no-cors",
                signal: controller.signal,
                cache: "no-store"
            });
            clearTimeout(timer);
            return Math.round(performance.now() - start);
        } catch (err) {
            clearTimeout(timer);
            try {
                const retryController = new AbortController();
                const retryTimer = setTimeout(() => retryController.abort(), 1000);
                await fetch(host.pingUrl || host.uploadUrl, {
                    method: "GET",
                    mode: "no-cors",
                    signal: retryController.signal,
                    headers: { Range: "bytes=0-0" },
                    cache: "no-store"
                });
                clearTimeout(retryTimer);
                return Math.round(performance.now() - start);
            } catch (e) {
                return 9999;
            }
        }
    }

    getHostTierPriority(hostId, fileSize) {
        const order = {
            tmpfiles: 1,
            uguu: 2,
            tempsh: 3,
            x0: 4,
            kappa: 5,
            gofile: 6,
            litterbox: 7,
            catbox: 8
        };
        return order[hostId] || 10;
    }

    async getRankedHostsForFile(file, forcedHostId = null) {
        const allHosts = this.getHosts();
        const eligibleHosts = [];

        for (const [key, host] of Object.entries(allHosts)) {
            if (this.settings.enabledHosts[key] === false && key !== forcedHostId) continue;
            if (file.size > host.maxSize) continue;
            eligibleHosts.push(host);
        }

        if (eligibleHosts.length === 0) {
            return [];
        }

        const targetHostId = forcedHostId || (this.settings.defaultHost !== "auto" ? this.settings.defaultHost : null);

        if (targetHostId) {
            const preferred = eligibleHosts.find(h => h.id === targetHostId);
            if (preferred) {
                const ping = await this.pingHost(preferred, this.settings.pingTimeoutMs);
                preferred.latency = ping;
                
                const others = eligibleHosts.filter(h => h.id !== preferred.id);
                const pingPromises = others.map(async (h) => {
                    h.latency = await this.pingHost(h, this.settings.pingTimeoutMs);
                    h.tier = this.getHostTierPriority(h.id, file.size);
                    return h;
                });
                const resolvedOthers = await Promise.all(pingPromises);
                resolvedOthers.sort((a, b) => (a.tier - b.tier) || (a.latency - b.latency));

                return [preferred, ...resolvedOthers];
            }
        }

        const benchmarkPromises = eligibleHosts.map(async (host) => {
            const latency = await this.pingHost(host, this.settings.pingTimeoutMs);
            const tier = this.getHostTierPriority(host.id, file.size);
            return {
                ...host,
                latency,
                tier
            };
        });

        const ranked = await Promise.all(benchmarkPromises);
        ranked.sort((a, b) => (a.tier - b.tier) || (a.latency - b.latency));
        return ranked;
    }

    showPreUploadModal(file, channelId) {
        this.removeModal();

        const category = this.getMediaCategory(file.name);
        const formattedSize = this.formatBytes(file.size);
        const allHosts = this.getHosts();

        const modalRoot = document.createElement("div");
        modalRoot.id = this.modalContainerId;
        modalRoot.className = "fatfiles_modal_backdrop";

        const optionsHtml = Object.values(allHosts)
            .filter(h => this.settings.enabledHosts[h.id] !== false)
            .map((h, index) => {
                const canFit = file.size <= h.maxSize;
                const formattedMax = this.formatBytes(h.maxSize);
                const isBest = index === 0;

                return `
                    <div class="fatfiles_host_option ${canFit ? 'fatfiles_option_valid' : 'fatfiles_option_disabled'} ${isBest && canFit ? 'fatfiles_option_selected' : ''}" 
                         data_host_id="${h.id}" ${canFit ? '' : 'title="File is too big for this host"'}>
                        <div class="fatfiles_option_radio">
                            <div class="fatfiles_radio_dot"></div>
                        </div>
                        <div class="fatfiles_option_content">
                            <div class="fatfiles_option_top">
                                <span class="fatfiles_option_name" style="color: ${h.color};">${h.name}</span>
                                <span class="fatfiles_option_retention">${h.retentionText}</span>
                            </div>
                            <div class="fatfiles_option_sub">
                                <span>Max capacity: ${formattedMax}</span>
                                <span class="fatfiles_option_status">${canFit ? 'Ready' : 'File too big'}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join("");

        modalRoot.innerHTML = `
            <div class="fatfiles_modal_box">
                <div class="fatfiles_modal_header">
                    <div class="fatfiles_modal_title_group">
                        <span class="fatfiles_modal_icon">📁</span>
                        <h3 class="fatfiles_modal_title">Upload Big File</h3>
                    </div>
                    <button class="fatfiles_modal_close" title="Close">✕</button>
                </div>

                <div class="fatfiles_file_preview_card">
                    <span class="fatfiles_preview_icon">${category.icon}</span>
                    <div class="fatfiles_preview_details">
                        <span class="fatfiles_preview_name" title="${this.escapeHtml(file.name)}">${this.escapeHtml(file.name)}</span>
                        <span class="fatfiles_preview_size">${formattedSize}</span>
                    </div>
                </div>

                <div class="fatfiles_modal_section_title">
                    Choose where to upload your file:
                </div>

                <div class="fatfiles_options_list">
                    <div class="fatfiles_host_option fatfiles_option_valid fatfiles_option_selected" data_host_id="auto">
                        <div class="fatfiles_option_radio">
                            <div class="fatfiles_radio_dot"></div>
                        </div>
                        <div class="fatfiles_option_content">
                            <div class="fatfiles_option_top">
                                <span class="fatfiles_option_name" style="color: #5865F2;">Auto Pick (Fastest Server)</span>
                                <span class="fatfiles_option_retention">Direct Player</span>
                            </div>
                            <div class="fatfiles_option_sub">
                                <span>Uses Tmpfiles.org high speed stream (18.5s)</span>
                                <span class="fatfiles_option_status" style="color: #2ed573;">Recommended</span>
                            </div>
                        </div>
                    </div>
                    ${optionsHtml}
                </div>

                <div class="fatfiles_modal_footer">
                    <label class="fatfiles_modal_remember">
                        <input type="checkbox" id="fatfiles_modal_dont_ask">
                        <span>Always upload automatically without asking</span>
                    </label>
                    <div class="fatfiles_modal_actions">
                        <button class="fatfiles_btn_secondary" id="fatfiles_modal_cancel_btn">Cancel</button>
                        <button class="fatfiles_btn_primary" id="fatfiles_modal_upload_btn">Upload Now</button>
                    </div>
                </div>
            </div>
        `;

        let selectedHostId = "auto";

        const options = modalRoot.querySelectorAll(".fatfiles_host_option.fatfiles_option_valid");
        options.forEach(opt => {
            opt.addEventListener("click", () => {
                modalRoot.querySelectorAll(".fatfiles_host_option").forEach(o => o.classList.remove("fatfiles_option_selected"));
                opt.classList.add("fatfiles_option_selected");
                selectedHostId = opt.getAttribute("data_host_id");
            });
        });

        const closeBtn = modalRoot.querySelector(".fatfiles_modal_close");
        const cancelBtn = modalRoot.querySelector("#fatfiles_modal_cancel_btn");
        const uploadBtn = modalRoot.querySelector("#fatfiles_modal_upload_btn");
        const rememberCheckbox = modalRoot.querySelector("#fatfiles_modal_dont_ask");

        const dismiss = () => this.removeModal();

        closeBtn.addEventListener("click", dismiss);
        cancelBtn.addEventListener("click", dismiss);

        uploadBtn.addEventListener("click", () => {
            if (rememberCheckbox && rememberCheckbox.checked) {
                this.settings.askBeforeUpload = false;
                this.saveSettings();
            }
            this.removeModal();
            this.startFileUpload(file, channelId, selectedHostId === "auto" ? null : selectedHostId);
        });

        modalRoot.addEventListener("click", (e) => {
            if (e.target === modalRoot) dismiss();
        });

        const appMount = document.getElementById("app-mount") || document.body;
        appMount.appendChild(modalRoot);
    }

    removeModal() {
        const modal = document.getElementById(this.modalContainerId);
        if (modal) modal.remove();
    }

    async startFileUpload(file, channelId, forcedHostId = null) {
        const uploadId = "upl_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
        const fileName = file.name || "unnamed_file";
        const formattedSize = this.formatBytes(file.size);

        BdApi.UI.showToast(`Uploading ${fileName} (${formattedSize})...`, { type: "info" });

        this.renderFloatingCard(uploadId, {
            fileName,
            fileSize: file.size,
            formattedSize,
            statusText: "Connecting to server...",
            progress: 0,
            speed: "0 KB/s",
            hostName: "Checking...",
            hostColor: "#5865F2"
        });

        const rankedHosts = await this.getRankedHostsForFile(file, forcedHostId);

        if (rankedHosts.length === 0) {
            this.updateFloatingCard(uploadId, {
                statusText: "File is too big for all enabled hosts",
                failed: true
            });
            BdApi.UI.alert(
                "File Too Big",
                `The file "${fileName}" (${formattedSize}) is bigger than the limits of your enabled upload hosts.`
            );
            return;
        }

        const errorsLog = [];
        let uploadSuccess = false;

        for (let i = 0; i < rankedHosts.length; i++) {
            const host = rankedHosts[i];
            const isFallback = i > 0;

            if (isFallback) {
                const prev = rankedHosts[i - 1];
                BdApi.UI.showToast(`${prev.name} had an issue. Trying ${host.name} instead...`, { type: "warning" });
            }

            this.updateFloatingCard(uploadId, {
                hostName: `${host.name} (${host.latency < 9000 ? host.latency + 'ms' : 'Ready'})`,
                hostColor: host.color,
                statusText: isFallback ? `Trying backup server (${i + 1}/${rankedHosts.length})...` : "Uploading file...",
                progress: 0,
                speed: "Connecting..."
            });

            try {
                const directUrl = await this.executeXHRUpload(uploadId, file, host);
                uploadSuccess = true;

                this.updateFloatingCard(uploadId, {
                    statusText: "Finished! Dropping link in chat...",
                    progress: 100,
                    speed: "Done",
                    completed: true
                });

                const formattedMsg = this.formatDirectUrlMessage(directUrl, file);
                await this.postResultToDiscord(channelId, formattedMsg);

                setTimeout(() => {
                    this.removeFloatingCard(uploadId);
                }, 3500);

                break;
            } catch (err) {
                errorsLog.push({
                    host: host.name,
                    error: err.message || String(err)
                });
            }
        }

        if (!uploadSuccess) {
            this.updateFloatingCard(uploadId, {
                statusText: "Upload failed. Click for details.",
                failed: true
            });

            const debugDetails = errorsLog.map(e => `• ${e.host}: ${e.error}`).join("\n");
            BdApi.UI.alert(
                "Upload Failed",
                `Could not upload "${fileName}" (${formattedSize}).\n\n${debugDetails}\n\nPlease check your internet and try again.`
            );
        }
    }

    async executeXHRUpload(uploadId, file, host) {
        let uploadUrl = host.uploadUrl;
        if (typeof host.getDynamicUploadUrl === "function") {
            uploadUrl = await host.getDynamicUploadUrl();
        } else if (typeof host.getUploadUrl === "function") {
            uploadUrl = host.getUploadUrl(file);
        }

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            let lastLoaded = 0;
            let lastTime = performance.now();
            let speedSmooth = 0;

            const cancelFn = () => {
                try {
                    xhr.abort();
                } catch (e) {}
                this.activeUploads.delete(uploadId);
                this.removeFloatingCard(uploadId);
                BdApi.UI.showToast("Cancelled upload.", { type: "info" });
                reject(new Error("Cancelled upload."));
            };

            this.activeUploads.set(uploadId, {
                xhr,
                file,
                host,
                cancel: cancelFn
            });

            xhr.upload.addEventListener("progress", (e) => {
                if (e.lengthComputable && e.total > 0) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    const now = performance.now();
                    const timeDelta = (now - lastTime) / 1000;

                    if (timeDelta >= 0.25) {
                        const loadedDelta = e.loaded - lastLoaded;
                        const currentSpeed = loadedDelta / timeDelta;
                        speedSmooth = speedSmooth === 0 ? currentSpeed : (speedSmooth * 0.7 + currentSpeed * 0.3);
                        lastLoaded = e.loaded;
                        lastTime = now;
                    }

                    const speedFormatted = this.formatSpeed(speedSmooth);
                    const etaFormatted = speedSmooth > 0 ? this.formatETA((e.total - e.loaded) / speedSmooth) : "";

                    this.updateFloatingCard(uploadId, {
                        progress: percent,
                        speed: speedFormatted,
                        statusText: etaFormatted ? `Time left: ${etaFormatted}` : "Uploading..."
                    });
                }
            });

            xhr.addEventListener("load", () => {
                this.activeUploads.delete(uploadId);
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const directUrl = host.parseResponse(xhr.responseText);
                        resolve(directUrl);
                    } catch (err) {
                        reject(new Error(`Could not read link from ${host.name}: ${err.message}`));
                    }
                } else {
                    reject(new Error(`Server gave error ${xhr.status} (${xhr.statusText || 'Unknown'})`));
                }
            });

            xhr.addEventListener("error", () => {
                this.activeUploads.delete(uploadId);
                reject(new Error(`Network error while connecting to ${host.name}`));
            });

            xhr.addEventListener("timeout", () => {
                this.activeUploads.delete(uploadId);
                reject(new Error(`Upload to ${host.name} took too long and timed out`));
            });

            xhr.addEventListener("abort", () => {
                this.activeUploads.delete(uploadId);
                reject(new Error(`Upload to ${host.name} was stopped`));
            });

            try {
                const method = host.method || "POST";
                const body = typeof host.prepareBody === "function" ? host.prepareBody(file, this.settings) : file;

                xhr.open(method, uploadUrl, true);
                xhr.timeout = 600000;

                if (typeof host.prepareHeaders === "function") {
                    const headers = host.prepareHeaders(this.settings);
                    for (const [hk, hv] of Object.entries(headers)) {
                        xhr.setRequestHeader(hk, hv);
                    }
                }

                xhr.send(body);
            } catch (sendError) {
                this.activeUploads.delete(uploadId);
                reject(new Error(`Could not start upload: ${sendError.message}`));
            }
        });
    }

    cancelAllActiveUploads() {
        for (const [id, upload] of this.activeUploads.entries()) {
            try {
                if (upload.xhr) upload.xhr.abort();
            } catch (e) {}
        }
        this.activeUploads.clear();
    }

    getMediaCategory(fileName) {
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        const video = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'];
        const image = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
        const audio = ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac', 'opus', 'wma'];
        const archive = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg'];
        const code = ['js', 'ts', 'jsx', 'tsx', 'py', 'json', 'html', 'css', 'cpp', 'c', 'cs', 'java', 'go', 'rs', 'php', 'sh', 'bat', 'ps1'];

        if (video.includes(ext)) return { isMedia: true, type: 'video', icon: '🎬' };
        if (image.includes(ext)) return { isMedia: true, type: 'image', icon: '🖼️' };
        if (audio.includes(ext)) return { isMedia: true, type: 'audio', icon: '🎵' };
        if (archive.includes(ext)) return { isMedia: false, type: 'archive', icon: '📦' };
        if (code.includes(ext)) return { isMedia: false, type: 'code', icon: '💻' };
        return { isMedia: false, type: 'document', icon: '📄' };
    }

    formatDirectUrlMessage(directUrl, file) {
        const category = this.getMediaCategory(file.name);
        
        if (category.isMedia && this.settings.smartMediaEmbeds) {
            return directUrl;
        }

        const sizeFormatted = this.formatBytes(file.size);
        return `${category.icon} **${file.name}** (${sizeFormatted})\n${directUrl}`;
    }

    injectStyles() {
        this.removeStyles();
        const css = `
            #${this.widgetContainerId} {
                position: fixed;
                bottom: 84px;
                right: 24px;
                z-index: 99999;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 360px;
                width: 100%;
                pointer-events: none;
                font-family: var(--font-primary, 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif);
            }

            .fatfiles_card {
                pointer-events: auto;
                background: rgba(30, 31, 34, 0.95);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                padding: 12px 14px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
                color: #ffffff;
                transition: all 0.25s ease;
                animation: fatfiles_slide_in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }

            @keyframes fatfiles_slide_in {
                from {
                    transform: translateY(20px) scale(0.95);
                    opacity: 0;
                }
                to {
                    transform: translateY(0) scale(1);
                    opacity: 1;
                }
            }

            .fatfiles_card.fatfiles_completed {
                border-color: rgba(46, 213, 115, 0.6);
                box-shadow: 0 8px 24px rgba(46, 213, 115, 0.2);
            }

            .fatfiles_card.fatfiles_failed {
                border-color: rgba(255, 71, 87, 0.6);
                box-shadow: 0 8px 24px rgba(255, 71, 87, 0.2);
            }

            .fatfiles_header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 8px;
            }

            .fatfiles_file_info {
                display: flex;
                align-items: center;
                gap: 8px;
                overflow: hidden;
            }

            .fatfiles_icon {
                font-size: 18px;
                flex-shrink: 0;
            }

            .fatfiles_name {
                font-size: 13px;
                font-weight: 600;
                color: #f2f3f5;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 200px;
            }

            .fatfiles_size {
                font-size: 11px;
                color: #949ba4;
                flex-shrink: 0;
            }

            .fatfiles_cancel_btn {
                background: none;
                border: none;
                color: #949ba4;
                cursor: pointer;
                padding: 4px;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: color 0.15s, background 0.15s;
            }

            .fatfiles_cancel_btn:hover {
                color: #ff4757;
                background: rgba(255, 71, 87, 0.15);
            }

            .fatfiles_meta_row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 11px;
                margin-bottom: 6px;
            }

            .fatfiles_host_badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 6px;
                border-radius: 4px;
                background: rgba(88, 101, 242, 0.2);
                color: #5865F2;
                font-weight: 600;
                font-size: 11px;
            }

            .fatfiles_speed_info {
                color: #dbdee1;
                font-weight: 500;
            }

            .fatfiles_progress_bg {
                width: 100%;
                height: 6px;
                background: rgba(255, 255, 255, 0.12);
                border-radius: 3px;
                overflow: hidden;
                position: relative;
            }

            .fatfiles_progress_bar {
                height: 100%;
                width: 0%;
                background: linear-gradient(90deg, #5865F2, #00b0f4);
                border-radius: 3px;
                transition: width 0.2s linear;
            }

            .fatfiles_card.fatfiles_completed .fatfiles_progress_bar {
                background: #2ed573;
            }

            .fatfiles_card.fatfiles_failed .fatfiles_progress_bar {
                background: #ff4757;
            }

            .fatfiles_status_row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-top: 6px;
                font-size: 11px;
                color: #949ba4;
            }

            .fatfiles_modal_backdrop {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: var(--font-primary, 'gg sans', 'Noto Sans', sans-serif);
                animation: fatfiles_fade_in 0.2s ease;
            }

            @keyframes fatfiles_fade_in {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            .fatfiles_modal_box {
                background: #1e1f22;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 16px;
                width: 100%;
                max-width: 500px;
                max-height: 85vh;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                animation: fatfiles_pop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            }

            @keyframes fatfiles_pop {
                from { transform: scale(0.92) translateY(12px); opacity: 0; }
                to { transform: scale(1) translateY(0); opacity: 1; }
            }

            .fatfiles_modal_header {
                padding: 16px 20px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }

            .fatfiles_modal_title_group {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .fatfiles_modal_icon {
                font-size: 20px;
            }

            .fatfiles_modal_title {
                font-size: 18px;
                font-weight: 700;
                color: #ffffff;
                margin: 0;
            }

            .fatfiles_modal_close {
                background: none;
                border: none;
                color: #949ba4;
                font-size: 16px;
                cursor: pointer;
                padding: 4px;
                border-radius: 6px;
            }

            .fatfiles_modal_close:hover {
                color: #ffffff;
                background: rgba(255, 255, 255, 0.08);
            }

            .fatfiles_file_preview_card {
                margin: 16px 20px 8px 20px;
                background: rgba(0, 0, 0, 0.25);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 10px;
                padding: 10px 14px;
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .fatfiles_preview_icon {
                font-size: 24px;
            }

            .fatfiles_preview_details {
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            .fatfiles_preview_name {
                font-size: 13px;
                font-weight: 600;
                color: #ffffff;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .fatfiles_preview_size {
                font-size: 12px;
                color: #2ed573;
                font-weight: 600;
            }

            .fatfiles_modal_section_title {
                padding: 8px 20px 6px 20px;
                font-size: 13px;
                font-weight: 600;
                color: #b5bac1;
            }

            .fatfiles_options_list {
                padding: 4px 20px 16px 20px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 8px;
                max-height: 280px;
            }

            .fatfiles_host_option {
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 10px;
                padding: 10px 12px;
                display: flex;
                align-items: center;
                gap: 12px;
                cursor: pointer;
                transition: all 0.15s ease;
            }

            .fatfiles_host_option:hover.fatfiles_option_valid {
                background: rgba(46, 213, 115, 0.12);
                border-color: rgba(46, 213, 115, 0.4);
            }

            .fatfiles_host_option.fatfiles_option_selected {
                background: rgba(46, 213, 115, 0.18);
                border-color: #2ed573;
            }

            .fatfiles_host_option.fatfiles_option_disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }

            .fatfiles_option_radio {
                width: 18px;
                height: 18px;
                border-radius: 50%;
                border: 2px solid #80848e;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }

            .fatfiles_host_option.fatfiles_option_selected .fatfiles_option_radio {
                border-color: #2ed573;
            }

            .fatfiles_radio_dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #2ed573;
                opacity: 0;
                transform: scale(0);
                transition: all 0.15s ease;
            }

            .fatfiles_host_option.fatfiles_option_selected .fatfiles_radio_dot {
                opacity: 1;
                transform: scale(1);
            }

            .fatfiles_option_content {
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .fatfiles_option_top {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .fatfiles_option_name {
                font-size: 13px;
                font-weight: 600;
            }

            .fatfiles_option_retention {
                font-size: 12px;
                color: #f2f3f5;
                font-weight: 500;
            }

            .fatfiles_option_sub {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 11px;
                color: #949ba4;
            }

            .fatfiles_modal_footer {
                padding: 14px 20px;
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: #111214;
            }

            .fatfiles_modal_remember {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                color: #949ba4;
                cursor: pointer;
            }

            .fatfiles_modal_actions {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .fatfiles_btn_secondary {
                background: transparent;
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: #ffffff;
                padding: 8px 16px;
                border-radius: 6px;
                font-weight: 600;
                font-size: 13px;
                cursor: pointer;
            }

            .fatfiles_btn_secondary:hover {
                background: rgba(255, 255, 255, 0.06);
            }

            .fatfiles_btn_primary {
                background: #2ed573;
                border: none;
                color: #ffffff;
                padding: 8px 18px;
                border-radius: 6px;
                font-weight: 600;
                font-size: 13px;
                cursor: pointer;
                transition: background 0.15s ease;
            }

            .fatfiles_btn_primary:hover {
                background: #26af5f;
            }

            .fatfiles_settings_container {
                display: flex;
                flex-direction: column;
                gap: 18px;
                padding: 4px 4px 16px 4px;
                color: #dbdee1;
                font-family: var(--font-primary, 'gg sans', 'Noto Sans', sans-serif);
            }

            .fatfiles_section_title {
                font-size: 12px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                color: #949ba4;
                margin-bottom: 6px;
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .fatfiles_card_group {
                background: #2b2d31;
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 10px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }

            .fatfiles_setting_item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.04);
                gap: 16px;
                transition: background 0.15s ease;
            }

            .fatfiles_setting_item:last-child {
                border-bottom: none;
            }

            .fatfiles_setting_item:hover {
                background: rgba(255, 255, 255, 0.02);
            }

            .fatfiles_setting_info {
                display: flex;
                flex-direction: column;
                gap: 2px;
                flex: 1;
            }

            .fatfiles_setting_label {
                font-size: 14px;
                font-weight: 600;
                color: #f2f3f5;
            }

            .fatfiles_setting_desc {
                font-size: 12px;
                color: #949ba4;
                line-height: 1.4;
            }

            .fatfiles_switch {
                position: relative;
                display: inline-block;
                width: 42px;
                height: 24px;
                flex-shrink: 0;
                cursor: pointer;
            }

            .fatfiles_switch input {
                opacity: 0;
                width: 0;
                height: 0;
                position: absolute;
            }

            .fatfiles_slider {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: #80848e;
                transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                border-radius: 12px;
            }

            .fatfiles_slider:before {
                position: absolute;
                content: "";
                height: 18px;
                width: 18px;
                left: 3px;
                bottom: 3px;
                background-color: #ffffff;
                transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                border-radius: 50%;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }

            .fatfiles_switch input:checked + .fatfiles_slider {
                background-color: #23a55a;
            }

            .fatfiles_switch input:checked + .fatfiles_slider:before {
                transform: translateX(18px);
            }

            .fatfiles_input_number {
                background: #1e1f22;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: #ffffff;
                padding: 6px 10px;
                font-size: 13px;
                font-weight: 600;
                width: 75px;
                text-align: center;
                outline: none;
                transition: border-color 0.15s, box-shadow 0.15s;
            }

            .fatfiles_input_number:focus {
                border-color: #5865F2;
                box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.25);
            }

            .fatfiles_select {
                background: #1e1f22;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: #ffffff;
                padding: 6px 12px;
                font-size: 13px;
                font-weight: 500;
                outline: none;
                cursor: pointer;
                max-width: 280px;
                width: 100%;
                transition: border-color 0.15s;
            }

            .fatfiles_select:focus {
                border-color: #5865F2;
            }

            .fatfiles_hosts_grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 8px;
            }

            .fatfiles_host_toggle_card {
                background: #2b2d31;
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                padding: 8px 12px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                transition: all 0.15s ease;
            }

            .fatfiles_host_toggle_card:hover {
                background: rgba(255, 255, 255, 0.04);
                border-color: rgba(255, 255, 255, 0.1);
            }

            .fatfiles_host_toggle_left {
                display: flex;
                align-items: center;
                gap: 8px;
                overflow: hidden;
            }

            .fatfiles_host_indicator {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                flex-shrink: 0;
            }

            .fatfiles_host_toggle_info {
                display: flex;
                flex-direction: column;
                gap: 1px;
                overflow: hidden;
            }

            .fatfiles_host_toggle_name {
                font-size: 13px;
                font-weight: 600;
                color: #f2f3f5;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .fatfiles_host_toggle_desc {
                font-size: 11px;
                color: #949ba4;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .fatfiles_radio_cards {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                width: 100%;
                margin-top: 6px;
            }

            .fatfiles_radio_card {
                background: #1e1f22;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 8px;
                padding: 10px 12px;
                cursor: pointer;
                display: flex;
                flex-direction: column;
                gap: 3px;
                transition: all 0.15s ease;
            }

            .fatfiles_radio_card:hover {
                background: rgba(255, 255, 255, 0.04);
                border-color: rgba(255, 255, 255, 0.15);
            }

            .fatfiles_radio_card.fatfiles_radio_active {
                background: rgba(88, 101, 242, 0.12);
                border-color: #5865F2;
            }

            .fatfiles_radio_card_title {
                font-size: 13px;
                font-weight: 600;
                color: #f2f3f5;
            }

            .fatfiles_radio_card.fatfiles_radio_active .fatfiles_radio_card_title {
                color: #5865F2;
            }

            .fatfiles_radio_card_desc {
                font-size: 11px;
                color: #949ba4;
            }

            .fatfiles_ping_box {
                background: #2b2d31;
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                padding: 12px 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
            }

            .fatfiles_ping_btn {
                background: #5865F2;
                color: #ffffff;
                border: none;
                border-radius: 6px;
                padding: 8px 16px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s ease;
                flex-shrink: 0;
            }

            .fatfiles_ping_btn:hover {
                background: #4752c4;
            }

            .fatfiles_ping_btn:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            .fatfiles_ping_results_area {
                margin-top: 8px;
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }

            .fatfiles_ping_chip {
                background: #1e1f22;
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 4px;
                padding: 4px 8px;
                font-size: 11px;
                font-weight: 500;
                color: #dbdee1;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }

            .fatfiles_ping_chip_good {
                color: #2ed573;
            }

            .fatfiles_ping_chip_bad {
                color: #ff4757;
            }
        `;

        if (BdApi.DOM && BdApi.DOM.addStyle) {
            BdApi.DOM.addStyle(this.styleElementId, css);
        } else if (BdApi.injectCSS) {
            BdApi.injectCSS(this.styleElementId, css);
        }
    }

    removeStyles() {
        if (BdApi.DOM && BdApi.DOM.removeStyle) {
            BdApi.DOM.removeStyle(this.styleElementId);
        } else if (BdApi.clearCSS) {
            BdApi.clearCSS(this.styleElementId);
        }
    }

    ensureDockContainer() {
        let container = document.getElementById(this.widgetContainerId);
        if (!container) {
            container = document.createElement("div");
            container.id = this.widgetContainerId;
            const appMount = document.getElementById("app-mount") || document.body;
            appMount.appendChild(container);
        }
        return container;
    }

    removeFloatingWidget() {
        const container = document.getElementById(this.widgetContainerId);
        if (container) container.remove();
    }

    renderFloatingCard(uploadId, data) {
        if (!this.settings.showFloatingWidget) return;
        const container = this.ensureDockContainer();
        const category = this.getMediaCategory(data.fileName);

        const card = document.createElement("div");
        card.id = `fatfiles_card_${uploadId}`;
        card.className = "fatfiles_card";
        card.innerHTML = `
            <div class="fatfiles_header">
                <div class="fatfiles_file_info">
                    <span class="fatfiles_icon">${category.icon}</span>
                    <span class="fatfiles_name" title="${this.escapeHtml(data.fileName)}">${this.escapeHtml(data.fileName)}</span>
                    <span class="fatfiles_size">${data.formattedSize}</span>
                </div>
                <button class="fatfiles_cancel_btn" title="Cancel upload">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="fatfiles_meta_row">
                <span class="fatfiles_host_badge" style="color: ${data.hostColor || '#5865F2'}; background: ${this.hexToRgba(data.hostColor || '#5865F2', 0.15)}">${this.escapeHtml(data.hostName || 'Auto')}</span>
                <span class="fatfiles_speed_info">${data.speed || '0 KB/s'}</span>
            </div>
            <div class="fatfiles_progress_bg">
                <div class="fatfiles_progress_bar" style="width: ${data.progress || 0}%"></div>
            </div>
            <div class="fatfiles_status_row">
                <span class="fatfiles_status_text">${this.escapeHtml(data.statusText || 'Starting...')}</span>
                <span class="fatfiles_percent_text">${data.progress || 0}%</span>
            </div>
        `;

        const cancelBtn = card.querySelector(".fatfiles_cancel_btn");
        cancelBtn.addEventListener("click", () => {
            const active = this.activeUploads.get(uploadId);
            if (active && typeof active.cancel === "function") {
                active.cancel();
            } else {
                this.removeFloatingCard(uploadId);
            }
        });

        container.appendChild(card);
    }

    updateFloatingCard(uploadId, data) {
        if (!this.settings.showFloatingWidget) return;
        const card = document.getElementById(`fatfiles_card_${uploadId}`);
        if (!card) return;

        if (data.hostName) {
            const hostBadge = card.querySelector(".fatfiles_host_badge");
            if (hostBadge) {
                hostBadge.textContent = data.hostName;
                if (data.hostColor) {
                    hostBadge.style.color = data.hostColor;
                    hostBadge.style.background = this.hexToRgba(data.hostColor, 0.15);
                }
            }
        }

        if (data.speed !== undefined) {
            const speedInfo = card.querySelector(".fatfiles_speed_info");
            if (speedInfo) speedInfo.textContent = data.speed;
        }

        if (data.progress !== undefined) {
            const progressBar = card.querySelector(".fatfiles_progress_bar");
            if (progressBar) progressBar.style.width = `${data.progress}%`;
            const percentText = card.querySelector(".fatfiles_percent_text");
            if (percentText) percentText.textContent = `${data.progress}%`;
        }

        if (data.statusText) {
            const statusText = card.querySelector(".fatfiles_status_text");
            if (statusText) statusText.textContent = data.statusText;
        }

        if (data.completed) {
            card.classList.add("fatfiles_completed");
        }

        if (data.failed) {
            card.classList.add("fatfiles_failed");
        }
    }

    removeFloatingCard(uploadId) {
        const card = document.getElementById(`fatfiles_card_${uploadId}`);
        if (card) {
            card.style.opacity = "0";
            card.style.transform = "translateY(10px) scale(0.95)";
            setTimeout(() => {
                if (card) card.remove();
            }, 250);
        }
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.className = "fatfiles_settings_container";

        const hosts = this.getHosts();
        const hostsGridHtml = Object.values(hosts).map(h => `
            <div class="fatfiles_host_toggle_card">
                <div class="fatfiles_host_toggle_left">
                    <span class="fatfiles_host_indicator" style="background: ${h.color};"></span>
                    <div class="fatfiles_host_toggle_info">
                        <span class="fatfiles_host_toggle_name">${h.name}</span>
                        <span class="fatfiles_host_toggle_desc">${h.retentionText} • ${this.formatBytes(h.maxSize)}</span>
                    </div>
                </div>
                <label class="fatfiles_switch">
                    <input type="checkbox" id="fatfiles_host_${h.id}" data_host_key="${h.id}" ${this.settings.enabledHosts[h.id] !== false ? 'checked' : ''}>
                    <span class="fatfiles_slider"></span>
                </label>
            </div>
        `).join("");

        panel.innerHTML = `
            <div>
                <div class="fatfiles_section_title">⚙️ General</div>
                <div class="fatfiles_card_group">
                    <div class="fatfiles_setting_item">
                        <div class="fatfiles_setting_info">
                            <div class="fatfiles_setting_label">Upload limit trigger (MB)</div>
                            <div class="fatfiles_setting_desc">Files larger than this will be uploaded to a fast server instead of Discord.</div>
                        </div>
                        <input type="number" id="fatfiles_threshold_input" class="fatfiles_input_number" min="1" max="100" value="${this.settings.uploadThresholdMB || 10}">
                    </div>
                    <div class="fatfiles_setting_item">
                        <div class="fatfiles_setting_info">
                            <div class="fatfiles_setting_label">Ask before uploading</div>
                            <div class="fatfiles_setting_desc">Shows a quick server picker popup when you drop big files.</div>
                        </div>
                        <label class="fatfiles_switch">
                            <input type="checkbox" id="fatfiles_ask_modal_toggle" ${this.settings.askBeforeUpload ? 'checked' : ''}>
                            <span class="fatfiles_slider"></span>
                        </label>
                    </div>
                    <div class="fatfiles_setting_item">
                        <div class="fatfiles_setting_info">
                            <div class="fatfiles_setting_label">Preferred host</div>
                            <div class="fatfiles_setting_desc">Choose a favorite server or leave it on Auto to pick the fastest one.</div>
                        </div>
                        <select id="fatfiles_default_host" class="fatfiles_select">
                            <option value="auto" ${this.settings.defaultHost === 'auto' ? 'selected' : ''}>Auto (Fastest Server)</option>
                            <option value="tmpfiles" ${this.settings.defaultHost === 'tmpfiles' ? 'selected' : ''}>Tmpfiles.org (10 GB, direct link)</option>
                            <option value="gofile" ${this.settings.defaultHost === 'gofile' ? 'selected' : ''}>Gofile.io (10 GB, cloud storage)</option>
                            <option value="tempsh" ${this.settings.defaultHost === 'tempsh' ? 'selected' : ''}>Temp.sh (4 GB, 3 days)</option>
                            <option value="litterbox" ${this.settings.defaultHost === 'litterbox' ? 'selected' : ''}>Litterbox (1 GB, 72 hours)</option>
                            <option value="x0" ${this.settings.defaultHost === 'x0' ? 'selected' : ''}>x0.at (512 MB, long retention)</option>
                            <option value="kappa" ${this.settings.defaultHost === 'kappa' ? 'selected' : ''}>Kappa.lol (500 MB, video player)</option>
                            <option value="catbox" ${this.settings.defaultHost === 'catbox' ? 'selected' : ''}>Catbox.moe (200 MB, permanent)</option>
                            <option value="uguu" ${this.settings.defaultHost === 'uguu' ? 'selected' : ''}>Uguu.se (100 MB, temporary)</option>
                        </select>
                    </div>
                </div>
            </div>

            <div>
                <div class="fatfiles_section_title">🌐 Active Upload Hosts</div>
                <div class="fatfiles_hosts_grid">
                    ${hostsGridHtml}
                </div>
            </div>

            <div>
                <div class="fatfiles_section_title">📤 Delivery & Display</div>
                <div class="fatfiles_card_group">
                    <div class="fatfiles_setting_item" style="flex-direction: column; align-items: stretch; gap: 8px;">
                        <div class="fatfiles_setting_info">
                            <div class="fatfiles_setting_label">How to post links</div>
                            <div class="fatfiles_setting_desc">Decide if you want to inspect links in your message box before sending.</div>
                        </div>
                        <div class="fatfiles_radio_cards">
                            <div class="fatfiles_radio_card ${this.settings.postingMode === 'draft' ? 'fatfiles_radio_active' : ''}" data_post_val="draft">
                                <span class="fatfiles_radio_card_title">✏️ Chat Box Draft</span>
                                <span class="fatfiles_radio_card_desc">Put in message box so you can write a message first</span>
                            </div>
                            <div class="fatfiles_radio_card ${this.settings.postingMode === 'send' ? 'fatfiles_radio_active' : ''}" data_post_val="send">
                                <span class="fatfiles_radio_card_title">🚀 Send Right Away</span>
                                <span class="fatfiles_radio_card_desc">Posts link straight to the channel automatically</span>
                            </div>
                        </div>
                    </div>
                    <div class="fatfiles_setting_item">
                        <div class="fatfiles_setting_info">
                            <div class="fatfiles_setting_label">Direct media embeds</div>
                            <div class="fatfiles_setting_desc">Sends direct URLs for videos and audio so Discord embeds them natively.</div>
                        </div>
                        <label class="fatfiles_switch">
                            <input type="checkbox" id="fatfiles_smart_embeds" ${this.settings.smartMediaEmbeds ? 'checked' : ''}>
                            <span class="fatfiles_slider"></span>
                        </label>
                    </div>
                    <div class="fatfiles_setting_item">
                        <div class="fatfiles_setting_info">
                            <div class="fatfiles_setting_label">Upload progress popup</div>
                            <div class="fatfiles_setting_desc">Shows live upload speed, ETA, progress bar, and cancel button.</div>
                        </div>
                        <label class="fatfiles_switch">
                            <input type="checkbox" id="fatfiles_show_widget" ${this.settings.showFloatingWidget ? 'checked' : ''}>
                            <span class="fatfiles_slider"></span>
                        </label>
                    </div>
                </div>
            </div>

            <div>
                <div class="fatfiles_section_title">🚀 Diagnostics</div>
                <div class="fatfiles_ping_box">
                    <div class="fatfiles_setting_info">
                        <div class="fatfiles_setting_label">Test Server Latency</div>
                        <div class="fatfiles_setting_desc">Pings all upload servers to check connection health and speeds.</div>
                    </div>
                    <button id="fatfiles_test_ping_btn" class="fatfiles_ping_btn">Test All Hosts</button>
                </div>
                <div id="fatfiles_ping_results" class="fatfiles_ping_results_area"></div>
            </div>
        `;

        const thresholdInput = panel.querySelector("#fatfiles_threshold_input");
        thresholdInput.addEventListener("change", (e) => {
            this.settings.uploadThresholdMB = Math.max(1, parseInt(e.target.value, 10) || 10);
            this.saveSettings();
        });

        const askModalToggle = panel.querySelector("#fatfiles_ask_modal_toggle");
        askModalToggle.addEventListener("change", (e) => {
            this.settings.askBeforeUpload = e.target.checked;
            this.saveSettings();
        });

        const defaultHostSelect = panel.querySelector("#fatfiles_default_host");
        defaultHostSelect.addEventListener("change", (e) => {
            this.settings.defaultHost = e.target.value;
            this.saveSettings();
        });

        const hostCheckboxes = panel.querySelectorAll("input[data_host_key]");
        hostCheckboxes.forEach(cb => {
            cb.addEventListener("change", (e) => {
                const key = cb.getAttribute("data_host_key");
                this.settings.enabledHosts[key] = e.target.checked;
                this.saveSettings();
            });
        });

        const radioCards = panel.querySelectorAll(".fatfiles_radio_card");
        radioCards.forEach(card => {
            card.addEventListener("click", () => {
                radioCards.forEach(c => c.classList.remove("fatfiles_radio_active"));
                card.classList.add("fatfiles_radio_active");
                const val = card.getAttribute("data_post_val");
                this.settings.postingMode = val;
                this.saveSettings();
            });
        });

        const smartEmbeds = panel.querySelector("#fatfiles_smart_embeds");
        smartEmbeds.addEventListener("change", (e) => {
            this.settings.smartMediaEmbeds = e.target.checked;
            this.saveSettings();
        });

        const showWidget = panel.querySelector("#fatfiles_show_widget");
        showWidget.addEventListener("change", (e) => {
            this.settings.showFloatingWidget = e.target.checked;
            this.saveSettings();
        });

        const testPingBtn = panel.querySelector("#fatfiles_test_ping_btn");
        const pingResults = panel.querySelector("#fatfiles_ping_results");

        testPingBtn.addEventListener("click", async () => {
            testPingBtn.disabled = true;
            testPingBtn.textContent = "Pinging...";
            pingResults.innerHTML = `<span class="fatfiles_ping_chip">Checking response times...</span>`;

            const hostsList = this.getHosts();
            const chips = [];

            for (const host of Object.values(hostsList)) {
                const latency = await this.pingHost(host, 3000);
                const isGood = latency < 9000;
                const statusClass = isGood ? 'fatfiles_ping_chip_good' : 'fatfiles_ping_chip_bad';
                const label = isGood ? `${latency}ms` : 'Timeout';
                chips.push(`
                    <span class="fatfiles_ping_chip">
                        <span style="color:${host.color}; font-weight:600;">${host.name}</span>
                        <span class="${statusClass}">${label}</span>
                    </span>
                `);
            }

            pingResults.innerHTML = chips.join("");
            testPingBtn.disabled = false;
            testPingBtn.textContent = "Test All Hosts";
        });

        return panel;
    }

    formatBytes(bytes, decimals = 2) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    formatSpeed(bytesPerSec) {
        if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
        if (bytesPerSec >= 1024 * 1024) {
            return (bytesPerSec / (1024 * 1024)).toFixed(2) + ' MB/s';
        }
        return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
    }

    formatETA(seconds) {
        if (!isFinite(seconds) || seconds <= 0) return '';
        const sec = Math.ceil(seconds);
        if (sec < 60) return `${sec}s`;
        const min = Math.floor(sec / 60);
        const remSec = sec % 60;
        return `${min}m ${remSec}s`;
    }

    hexToRgba(hex, alpha = 1) {
        let cleanHex = hex.replace('#', '');
        if (cleanHex.length === 3) {
            cleanHex = cleanHex.split('').map(c => c + c).join('');
        }
        const num = parseInt(cleanHex, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};
