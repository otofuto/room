// グローバル変数
let employees = JSON.parse(localStorage.getItem('employees') || '[]');
let entranceStatus = JSON.parse(localStorage.getItem('entranceStatus') || '{}');
let logs = JSON.parse(localStorage.getItem('logs') || '[]');
let currentEditingId = null;
let currentEmployee = null;
let lastScanTime = 0;
let isExitReasonMode = false;
let isQuaggaInitialized = false;
let audioEnabled = false;
let quaggaDetectionHandler = null;
let currentMediaStream = null;

let isFaceApiInitialized = false;
let faceDetectionInterval = null;
let faceDetected = false;
let lastFaceDetectionTime = 0;
let isFaceDetectionActive = false;
let tempFaceDescriptors = [];
let faceDescriptors = JSON.parse(localStorage.getItem('faceDescriptors') || '[]');
let faceDescriptorExtracted = false;

let recognition = null;
let isVoiceRecognitionActive = false;
let voiceRecognitionTimeout = null;
let voiceTestMode = false;
let faceDisappearTimer = null;

// 設定データ
const exitReasonSounds = {
    "帰宅": {
        "anytime": ["「あれれ、もう終わっちゃうの？」.mp3", "「バイバーイ」.mp3", "「また明日」.mp3"],
        "morning": [],
        "day": ["「お疲れ様です」.mp3"],
        "night": ["「お疲れ様です」.mp3", "「おやすみなさい」.mp3"]
    },
    "買い物": {
        "anytime": ["「バイバーイ」.mp3"]
    },
    "社長案件": {
        "anytime": ["「お疲れ様です」.mp3"]
    },
    "早退": {
        "anytime": ["「また明日」.mp3"]
    }
};

const voiceResponseMap = {
    "「侵入者発見！侵入者発見！」.mp3": ["不審", "侵入", "誰", "知らない", "不正", "エラー"],
    "「ありがと！」.mp3": ["ありがと", "あざす", "サンクス", "thx"],
    "「ありがとうございます」.mp3": ["ありがとう", "どうも", "感謝", "サンキュー", "やるじゃん", "やるやん"],
    "「あれれ、もう終わっちゃうの？」.mp3": ["早い", "短い", "早退", "終わり"],
    "「えへへ…」.mp3": ["かわいい", "可愛い", "すごい", "いいね", "上手", "すげえな"],
    "「おやすみなさい」.mp3": ["おやすみ", "今日"],
    "「お疲れ様です」.mp3": ["疲れ", "おつ", "お疲れ"],
    "「ごめんねっ」.mp3": ["ごめん", "すいません", "遅刻", "遅れ", "申し訳"],
    "「しつこいなあ」.mp3": ["しつこい", "何度", "また"],
    "「はい」.mp3": ["おい", "お前", "なあ", "うるせえ", "黙れ"],
    "「バイバーイ」.mp3": ["バイバイ", "ばいばい", "bye", "またね"],
    "「また明日」.mp3": ["さよなら", "帰る", "失礼します", "退社", "お先"],
    "「やったね！」.mp3": ["やった", "よし", "成功", "できた", "完了", "終わった"],
    "「呼びました？」.mp3": ["すみません", "あの", "ちょっと", "おーい", "ねえ"],
    "konnichiwa.mp3": ["こんにちは", "やっほー", "うっす"],
    "konbanha.mp3": ["こんばんは"],
    "ohayou.mp3": ["おはよう", "おはー"]
};

// ユーティリティ関数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function saveData() {
    localStorage.setItem('employees', JSON.stringify(employees));
    localStorage.setItem('entranceStatus', JSON.stringify(entranceStatus));
    localStorage.setItem('logs', JSON.stringify(logs));
    localStorage.setItem('faceDescriptors', JSON.stringify(faceDescriptors));
}

// 初期化関数
function enableAudioAndVoice() {
    audioEnabled = true;
    document.getElementById('audio-enable-overlay').classList.add('hidden');
    
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvGccCDWa3/LRfisEJZTZ9cKIVw0SXdTm9qA6CB1PJHzfwkgIwgZCYkXLKaWL1zlBjdmOOT0UXrDq8KhQEQZRz+Xu');
        audio.volume = 0.1;
        audio.play().catch(() => {});
    } catch (e) {}
    
    initializeVoiceRecognition();
    initializeApp();
}

function initializeApp() {
    renderEmployeeList();
    renderLogs();
    initializeScanner();
    initializeFaceApi();
}

// 音声認識機能
function initializeVoiceRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.log('音声認識はサポートされていません');
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = function(event) {
        const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase();
        console.log('音声認識結果:', transcript);
        checkVoiceResponse(transcript);
    };

    recognition.onerror = function(event) {
        console.log('音声認識エラー:', event.error);
    };

    recognition.onend = function() {
        updateMicIndicator(false);
        isVoiceRecognitionActive = false;
        
        if (faceDisappearTimer) {
            clearTimeout(faceDisappearTimer);
            faceDisappearTimer = null;
        }
        if (voiceRecognitionTimeout) {
            clearTimeout(voiceRecognitionTimeout);
            voiceRecognitionTimeout = null;
        }
    };

    startVoiceTest();
}

function startVoiceTest() {
    voiceTestMode = true;
    
    if (!recognition || isVoiceRecognitionActive) return;
    
    try {
        recognition.start();
        isVoiceRecognitionActive = true;
        updateMicIndicator(true);
        
        setTimeout(() => {
            voiceTestMode = false;
            stopVoiceRecognition();
            hideStatus();
        }, 10000);
        
    } catch (e) {
        console.log('音声認識テスト開始エラー:', e);
        voiceTestMode = false;
        hideStatus();
    }
}

function startVoiceRecognition() {
    if (!recognition || isVoiceRecognitionActive) return;
    
    try {
        recognition.start();
        isVoiceRecognitionActive = true;
        updateMicIndicator(true);
        
        if (voiceRecognitionTimeout) {
            clearTimeout(voiceRecognitionTimeout);
        }
        
        voiceRecognitionTimeout = setTimeout(() => {
            stopVoiceRecognition();
        }, 10000);
        
    } catch (e) {
        console.log('音声認識開始エラー:', e);
    }
}

function startVoiceRecognitionForFace() {
    if (!recognition) {
        console.log('音声認識未初期化');
        return;
    }
    if (isVoiceRecognitionActive) {
        console.log('音声認識既に動作中');
        return;
    }
    
    try {
        console.log('音声認識開始');
        recognition.start();
        isVoiceRecognitionActive = true;
        updateMicIndicator(true);
        
        if (voiceRecognitionTimeout) {
            clearTimeout(voiceRecognitionTimeout);
            voiceRecognitionTimeout = null;
        }
        
    } catch (e) {
        console.log('音声認識開始エラー:', e);
        isVoiceRecognitionActive = false;
        updateMicIndicator(false);
    }
}

function stopVoiceRecognition() {
    if (!recognition || !isVoiceRecognitionActive) return;
    
    try {
        recognition.stop();
        isVoiceRecognitionActive = false;
        updateMicIndicator(false);
        
        if (voiceRecognitionTimeout) {
            clearTimeout(voiceRecognitionTimeout);
            voiceRecognitionTimeout = null;
        }
    } catch (e) {
        console.log('音声認識停止エラー:', e);
    }
}

function updateMicIndicator(isActive) {
    const indicator = document.getElementById('mic-indicator');
    if (isActive) {
        indicator.classList.remove('hidden');
    } else {
        indicator.classList.add('hidden');
    }
}

// 音声再生機能
function checkVoiceResponse(transcript) {
    for (const [audioFile, keywords] of Object.entries(voiceResponseMap)) {
        if (keywords.some(keyword => transcript.includes(keyword))) {
            playVoiceResponse(audioFile);
            break;
        }
    }
}

function playVoiceResponse(fileName) {
    if (!audioEnabled) return;
    
    try {
        const audio = new Audio('/st/' + fileName);
        audio.volume = 0.3;
        audio.play().catch(e => {
            console.log('音声再生に失敗:', e);
        });
    } catch (e) {
        console.log('音声ファイルが見つかりません:', fileName);
    }
}

function playSound(type) {
    if (!audioEnabled) return;
    
    let fileName;
    
    switch(type) {
        case 'enter':
            fileName = 'enter.mp3';
            break;
        case 'exit':
            fileName = 'exit.mp3';
            break;
        case 'error':
            fileName = 'error.mp3';
            break;
        case 'success':
            fileName = 'success.mp3';
            break;
        case 'hello':
            fileName = getRandomGreetingSound();
            break;
        default:
            return;
    }
    
    try {
        const audio = new Audio('/st/' + fileName);
        audio.volume = 0.3;
        audio.play().catch(e => {
            console.log('音声再生に失敗:', e);
        });
    } catch (e) {
        console.log('音声ファイルが見つかりません:', fileName);
    }
}

function getRandomGreetingSound() {
    const random = Math.floor(Math.random() * 7);
    
    if (random >= 0 && random <= 3) {
        const hour = new Date().getHours();
        if (hour < 11) {
            return 'ohayou.mp3';
        } else if (hour < 17) {
            return 'konnichiwa.mp3';
        } else {
            return 'konbanha.mp3';
        }
    } else if (random === 4) {
        return 'hi.mp3';
    } else if (random === 5) {
        return 'yahoo.mp3';
    } else {
        return 'ya.mp3';
    }
}

function playExitReasonSound(reason) {
    const soundConfig = exitReasonSounds[reason];
    if (!soundConfig) return false;
    
    const hour = new Date().getHours();
    let soundCandidates = [...soundConfig.anytime];
    
    if (reason === "帰宅") {
        if (hour >= 6 && hour < 11) {
            soundCandidates.push(...soundConfig.morning);
        } else if (hour >= 11 && hour < 17) {
            soundCandidates.push(...soundConfig.day);
        } else {
            soundCandidates.push(...soundConfig.night);
        }
    }
    
    if (soundCandidates.length > 0) {
        const randomSound = soundCandidates[Math.floor(Math.random() * soundCandidates.length)];
        playVoiceResponse(randomSound);
        return true;
    }
    
    return false;
}

// イベントリスナー
document.addEventListener('DOMContentLoaded', function() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('data:text/javascript;base64,c2VsZi5hZGRFdmVudExpc3RlbmVyKCdpbnN0YWxsJywgZXZlbnQgPT4geyBzZWxmLnNraXBXYWl0aW5nKCk7IH0pOyBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoJ2ZldGNoJywgZXZlbnQgPT4geyBldmVudC5yZXNwb25kV2l0aChmZXRjaChldmVudC5yZXF1ZXN0KSk7IH0pOw==');
    }
});

window.addEventListener('beforeunload', function() {
    stopCamera();
    stopVoiceRecognition();
});

document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        stopCamera();
        stopVoiceRecognition();
    }
});