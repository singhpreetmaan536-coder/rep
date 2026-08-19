const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const TOKEN = process.env.TELEGRAM_TOKEN || "8743584401:AAHnZxV5jqZA_l3Y5zYMQ_IThburE2SErDY";
const ADMIN_ID = process.env.ADMIN_ID || "7145835109";

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// FIXED: user.json
const USERS_FILE = path.join(__dirname, 'user.json');

let allowedUsers = [String(ADMIN_ID)];

if (fs.existsSync(USERS_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        allowedUsers = (data.allowedUsers || []).map(id => String(id));
    } catch (e) {
        console.log("Error loading users:", e.message);
    }
}

// Hamesha current admin ko force add karo
if (!allowedUsers.includes(String(ADMIN_ID))) {
    allowedUsers.push(String(ADMIN_ID));
}
saveUsers();

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ allowedUsers }, null, 2));
}

console.log("🤖 Telegram Bot + Mini App Started...");
console.log("👑 Admin ID:", ADMIN_ID);
console.log("📋 Allowed Users:", allowedUsers);

// ===================== TELEGRAM BOT =====================
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const text = msg.text || '';

    if (text === '/start') {
        const isAllowed = allowedUsers.includes(userId);
        const webAppUrl = process.env.WEB_APP_URL;

        if (!webAppUrl) {
            return bot.sendMessage(chatId, "❌ WEB_APP_URL not configured on Railway!");
        }

        let opts = {};

        if (isAllowed) {
            opts = {
                reply_markup: {
                    inline_keyboard: [[{
                        text: "🚀 Open Report Tool",
                        web_app: { url: webAppUrl }
                    }]]
                }
            };
        }

        const statusText = isAllowed ? "✅ Authorized" : "❌ Not Authorized";

        bot.sendMessage(chatId,
            `👋 Welcome to *PAID ASSASSIN*\n\n` +
            `Status: ${statusText}\n\n` +
            `Your ID: \`${userId}\`\n\n` +
            `${isAllowed ? 'Click button below...' : '❌ Access Denied!\nBy a subscription from @levitism'}`,
            { parse_mode: "Markdown", ...opts }
        );
    }

    // Admin Commands
    if (userId === String(ADMIN_ID)) {
        if (text.startsWith('/add ')) {
            const parts = text.split(' ').slice(1).filter(Boolean);
            if (parts.length === 0) return bot.sendMessage(chatId, "Usage: /add <userid1> <userid2> ...");

            const added = [];
            const already = [];

            for (const target of parts) {
                const upper = String(target).trim();
                if (!upper) continue;
                if (!allowedUsers.includes(upper)) {
                    allowedUsers.push(upper);
                    added.push(upper);
                } else {
                    already.push(upper);
                }
            }

            if (added.length > 0) saveUsers();

            let msg = '';
            if (added.length) msg += `✅ Added (${added.length}):\n${added.join('\n')}\n\n`;
            if (already.length) msg += `⚠️ Already exists (${already.length}):\n${already.join('\n')}`;
            if (!msg) msg = "⚠️ No valid user IDs found.";

            bot.sendMessage(chatId, msg.trim());
        }
        
        if (text.startsWith('/remove ')) {
            const target = String(text.split(' ')[1] || "").trim();
            if (!target) return bot.sendMessage(chatId, "Usage: /remove <userid>");
            if (target === String(ADMIN_ID)) return bot.sendMessage(chatId, "Cannot remove admin!");
            
            allowedUsers = allowedUsers.filter(id => id !== target);
            saveUsers();
            bot.sendMessage(chatId, `✅ User ${target} removed.`);
        }
        
        if (text === '/users') {
            bot.sendMessage(chatId, `📋 Allowed Users:\n${allowedUsers.join('\n')}`);
        }
    }
});

// ===================== EXPRESS ROUTES =====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/users', (req, res) => {
    res.json({ allowedUsers });
});

// Decode HTML entities helper
function decodeHTMLEntities(text) {
    if (!text) return "";
    return text
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(num))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
}

// Username check (upgraded with full profile + ban status)
app.post('/check-username', async (req, res) => {
    let { username } = req.body;

    if (!username) {
        return res.json({ exists: false, status: "BANNED" });
    }

    username = username.trim().toLowerCase().replace('@', '');

    console.log(`Checking: ${username}`);

    // Method 1 - Official web_profile_info API
    try {
        const headers = {
            "x-ig-app-id": "936619743392459",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "*/*",
            "Referer": "https://www.instagram.com/"
        };

        const response = await axios.get(
            `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
            { headers, timeout: 12000, validateStatus: () => true }
        );

        if (response.status === 200 && response.data?.data?.user) {
            const user = response.data.data.user;
            return res.json({
                exists: true,
                status: "ACTIVE",
                username: user.username,
                user: {
                    full_name: user.full_name || username,
                    username: user.username,
                    biography: user.biography || "",
                    followers: user.edge_followed_by?.count || 0,
                    following: user.edge_follow?.count || 0,
                    posts: user.edge_owner_to_timeline_media?.count || 0,
                    profile_pic: user.profile_pic_url_hd || user.profile_pic_url || ""
                }
            });
        }
    } catch (e) {
        console.log("Method 1 error:", e.message);
    }

    // Method 2 - Public page scrape
    try {
        const pageRes = await axios.get(`https://www.instagram.com/${username}/`, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            timeout: 12000
        });

        const html = pageRes.data;

        if (html.includes("og:title") || html.includes(`"username":"${username}"`)) {
            let fullName = username;
            let biography = "";
            let profilePic = "";
            let followers = "—", following = "—", posts = "—";

            const titleMatch = html.match(/property="og:title" content="([^"]+)"/i);
            if (titleMatch) fullName = decodeHTMLEntities(titleMatch[1].split('(')[0].trim());

            const descMatch = html.match(/property="og:description" content="([^"]+)"/i);
            if (descMatch) {
                let raw = decodeHTMLEntities(descMatch[1]);
                raw = raw.split(" - See Instagram")[0].trim();
                biography = raw;

                const nums = raw.match(/([\d,.]+[KMB]?)\s+Followers.*?([\d,.]+[KMB]?)\s+Following.*?([\d,.]+[KMB]?)\s+Posts/i);
                if (nums) {
                    followers = nums[1];
                    following = nums[2];
                    posts = nums[3];
                }
            }

            const picMatch = html.match(/property="og:image" content="([^"]+)"/i);
            if (picMatch) profilePic = picMatch[1];

            return res.json({
                exists: true,
                status: "ACTIVE",
                username,
                user: {
                    full_name: fullName,
                    username,
                    biography,
                    followers,
                    following,
                    posts,
                    profile_pic: profilePic
                }
            });
        }
    } catch (e) {
        console.log("Method 2 error:", e.message);
    }

    // Method 3 - Original bloks search (fallback)
    try {
        const device = uuidv4();
        const family = uuidv4();
        const android = "android-" + Math.random().toString(36).substring(2, 12);

        const payload = {
            params: `{"client_input_params":{"aac":"{\\"aac_init_timestamp\\":${Math.floor(Date.now()/1000)},\\"aacjid\\":\\"${uuidv4()}\\",\\"aaccs\\":\\"${Math.random().toString(36).substring(2,40)}\\"}","search_query":"${username}","search_screen_type":"email_or_username","ig_android_qe_device_id":"${device}"}}`,
            bk_client_context: '{"bloks_version":"5e47baf35c5a270b44c8906c8b99063564b30ef69779f3dee0b828bee2e4ef5b","styles_id":"instagram"}',
            bloks_versioning_id: "5e47baf35c5a270b44c8906c8b99063564b30ef69779f3dee0b828bee2e4ef5b"
        };

        const headers = {
            'User-Agent': "Instagram 370.1.0.43.96 Android (34/14; 450dpi;1080x2207;samsung;SM-A235F;a23;qcom;en_IN;704872281)",
            'accept-language': 'en-IN,en-US',
            'x-ig-app-id': '567067343352427',
            'x-ig-device-id': device,
            'x-ig-family-device-id': family,
            'x-ig-android-id': android,
            'x-mid': Buffer.from(Math.random().toString(36).substring(2,20)).toString('base64').replace(/=/g,'')
        };

        const response = await axios.post(
            "https://i.instagram.com/api/v1/bloks/async_action/com.bloks.www.caa.ar.search.async/",
            payload,
            { headers, timeout: 15000 }
        );

        const text = response.data.toString().toLowerCase();

        if (text.includes(`"${username}"`) && !text.includes('"not_found"') && !text.includes('no_results')) {
            return res.json({ exists: true, status: "ACTIVE", username });
        }

    } catch (error) {
        console.log("Method 3 error:", error.message);
    }

    return res.json({ exists: false, status: "BANNED" });
});

// Alias endpoint (same logic as /check-username)
app.post('/api/check', async (req, res) => {
    let { username } = req.body;
    if (!username) return res.json({ exists: false, status: "BANNED" });
    username = username.trim().toLowerCase().replace('@', '');

    // Method 1
    try {
        const headers = {
            "x-ig-app-id": "936619743392459",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "*/*",
            "Referer": "https://www.instagram.com/"
        };
        const response = await axios.get(
            `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
            { headers, timeout: 12000, validateStatus: () => true }
        );
        if (response.status === 200 && response.data?.data?.user) {
            const user = response.data.data.user;
            return res.json({
                exists: true,
                status: "ACTIVE",
                username: user.username,
                user: {
                    full_name: user.full_name || username,
                    username: user.username,
                    biography: user.biography || "",
                    followers: user.edge_followed_by?.count || 0,
                    following: user.edge_follow?.count || 0,
                    posts: user.edge_owner_to_timeline_media?.count || 0,
                    profile_pic: user.profile_pic_url_hd || user.profile_pic_url || ""
                }
            });
        }
    } catch (e) {}

    // Method 2
    try {
        const pageRes = await axios.get(`https://www.instagram.com/${username}/`, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
            timeout: 12000
        });
        const html = pageRes.data;
        if (html.includes("og:title") || html.includes(`"username":"${username}"`)) {
            let fullName = username, biography = "", profilePic = "";
            let followers = "—", following = "—", posts = "—";
            const titleMatch = html.match(/property="og:title" content="([^"]+)"/i);
            if (titleMatch) fullName = decodeHTMLEntities(titleMatch[1].split('(')[0].trim());
            const descMatch = html.match(/property="og:description" content="([^"]+)"/i);
            if (descMatch) {
                let raw = decodeHTMLEntities(descMatch[1]);
                raw = raw.split(" - See Instagram")[0].trim();
                biography = raw;
                const nums = raw.match(/([\d,.]+[KMB]?)\s+Followers.*?([\d,.]+[KMB]?)\s+Following.*?([\d,.]+[KMB]?)\s+Posts/i);
                if (nums) { followers = nums[1]; following = nums[2]; posts = nums[3]; }
            }
            const picMatch = html.match(/property="og:image" content="([^"]+)"/i);
            if (picMatch) profilePic = picMatch[1];
            return res.json({
                exists: true, status: "ACTIVE", username,
                user: { full_name: fullName, username, biography, followers, following, posts, profile_pic: profilePic }
            });
        }
    } catch (e) {}

    return res.json({ exists: false, status: "BANNED" });
});

// Login
app.post('/api/login', (req, res) => {
    const { userId } = req.body;
    if (allowedUsers.includes(String(userId))) {
        return res.json({ success: true });
    }
    res.json({ success: false });
});

// Admin APIs
app.post('/api/add-user', (req, res) => {
    const { userId, adminId } = req.body;
    if (String(adminId) !== String(ADMIN_ID)) return res.json({ success: false });

    const upperId = String(userId).trim();
    if (!allowedUsers.includes(upperId)) {
        allowedUsers.push(upperId);
        saveUsers();
    }
    res.json({ success: true, allowedUsers });
});

app.post('/api/remove-user', (req, res) => {
    const { userId, adminId } = req.body;
    if (String(adminId) !== String(ADMIN_ID)) return res.json({ success: false });
    if (String(userId) === String(ADMIN_ID)) return res.json({ success: false });

    allowedUsers = allowedUsers.filter(id => id !== String(userId));
    saveUsers();
    res.json({ success: true, allowedUsers });
});

app.get('/api/allowed-users', (req, res) => {
    res.json({ allowedUsers });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
