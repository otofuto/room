// 顔認識機能
async function initializeFaceApi() {
    if (isFaceApiInitialized) return;
    
    try {
        console.log('Face-api.js初期化開始...');
        
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri('https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'),
            faceapi.nets.faceLandmark68Net.loadFromUri('https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'),
            faceapi.nets.faceRecognitionNet.loadFromUri('https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights')
        ]);
        
        isFaceApiInitialized = true;
        console.log('Face-api.js初期化完了');
        startFaceDetection();
    } catch (error) {
        console.error('Face-api.js初期化エラー:', error);
        try {
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights'),
                faceapi.nets.faceLandmark68Net.loadFromUri('https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights'),
                faceapi.nets.faceRecognitionNet.loadFromUri('https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights')
            ]);
            isFaceApiInitialized = true;
            console.log('Face-api.js初期化完了（代替パス1）');
            startFaceDetection();
        } catch (secondError) {
            console.error('代替パス1失敗:', secondError);
            try {
                await Promise.all([
                    faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights'),
                    faceapi.nets.faceLandmark68Net.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights'),
                    faceapi.nets.faceRecognitionNet.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights')
                ]);
                isFaceApiInitialized = true;
                console.log('Face-api.js初期化完了（代替パス2）');
                startFaceDetection();
            } catch (thirdError) {
                console.error('Face-api.js初期化失敗（全パス）:', thirdError);
                updateFaceStatus('モデル読み込み失敗');
            }
        }
    }
}

function startFaceDetection() {
    if (!isFaceApiInitialized || faceDetectionInterval) return;
    
    isFaceDetectionActive = true;
    updateFaceStatus('検出中...');
    
    faceDetectionInterval = setInterval(async () => {
        await detectFaces();
    }, 1000);
}

function stopFaceDetection() {
    isFaceDetectionActive = false;
    if (faceDetectionInterval) {
        clearInterval(faceDetectionInterval);
        faceDetectionInterval = null;
    }
    updateFaceStatus('停止中');
    clearFaceOverlay();
    stopVoiceRecognition();
    
    if (faceDisappearTimer) {
        clearTimeout(faceDisappearTimer);
        faceDisappearTimer = null;
    }
}

async function detectFaces() {
    if (!isFaceApiInitialized || !isFaceDetectionActive) return;
    
    try {
        const video = document.querySelector('#scanner-container video');
        if (!video || video.readyState !== 4) return;
        
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({
            inputSize: 416,
            scoreThreshold: 0.5
        }));
        
        const now = Date.now();
        
        if (detections.length > 0) {
            updateFaceStatus(`顔検出: ${detections.length}人`);
            drawFaceBoxes(video, detections);
            
            if (faceDisappearTimer) {
                clearTimeout(faceDisappearTimer);
                faceDisappearTimer = null;
            }
            
            if (!faceDetected) {
                faceDetected = true;
                faceDescriptorExtracted = false;
                playSound('hello');
                console.log('顔検出: こんにちは音声再生');
                
                extractFaceDescriptors(video, detections, now);
                
                if (!voiceTestMode && !isVoiceRecognitionActive) {
                    console.log('音声認識開始を試行');
                    startVoiceRecognitionForFace();
                }
            }
            
            lastFaceDetectionTime = now;
        } else {
            updateFaceStatus('顔検出: なし');
            clearFaceOverlay();
            
            if (faceDetected && now - lastFaceDetectionTime > 1000) {
                faceDetected = false;
                faceDescriptorExtracted = false;
                console.log('顔消失: 10秒タイマー開始');
                
                if (faceDisappearTimer) {
                    clearTimeout(faceDisappearTimer);
                }
                faceDisappearTimer = setTimeout(() => {
                    stopVoiceRecognition();
                    faceDisappearTimer = null;
                }, 10000);
            }
        }
        
    } catch (error) {
        console.error('顔検出エラー:', error);
        updateFaceStatus('検出エラー');
    }
}

async function extractFaceDescriptors(video, detections, timestamp) {
    if (faceDescriptorExtracted) return;
    
    try {
        const detectionsWithDescriptors = await Promise.all(
            detections.map(async (detection) => {
                try {
                    const landmarks = await faceapi.detectFaceLandmarks(video, detection);
                    if (!landmarks) {
                        console.warn('ランドマーク検出に失敗');
                        return null;
                    }
                    
                    const descriptor = await faceapi.computeFaceDescriptor(video, landmarks);
                    if (!descriptor) {
                        console.warn('特徴量抽出に失敗');
                        return null;
                    }
                    
                    return {
                        detection: detection,
                        descriptor: descriptor
                    };
                } catch (error) {
                    console.error('個別の顔特徴抽出エラー:', error);
                    return null;
                }
            })
        );
        
        const validDetections = detectionsWithDescriptors.filter(d => d !== null);
        
        if (validDetections.length > 0) {
            faceDescriptorExtracted = true;
            processFaceDescriptors(validDetections, timestamp);
        } else {
            console.warn('有効な顔特徴を抽出できませんでした');
        }
        
    } catch (error) {
        console.error('顔特徴抽出エラー:', error);
        updateFaceStatus('特徴抽出エラー');
    }
}

function processFaceDescriptors(detectionsWithDescriptors, timestamp) {
    tempFaceDescriptors = [];
    
    let intruderDetected = false;
    
    detectionsWithDescriptors.forEach((detection, index) => {
        const descriptor = detection.descriptor;
        const box = detection.detection.box;
        
        tempFaceDescriptors.push({
            descriptor: Array.from(descriptor),
            timestamp: timestamp,
            box: box
        });
        
        const matchedEmployee = findMatchingEmployee(descriptor);
        
        if (matchedEmployee) {
            displayEmployeeName(matchedEmployee.name, index);
        } else {
            intruderDetected = true;
        }
    });
    
    if (intruderDetected) {
        console.log('侵入者を検出');
        playVoiceResponse('「侵入者発見！侵入者発見！」.mp3');
    }
}

function findMatchingEmployee(descriptor) {
    let bestMatch = null;
    let bestDistance = Infinity;
    
    // 全ての顔特徴データと照合し、最も距離が近い（類似度が高い）ものを選択
    for (const savedFace of faceDescriptors) {
        const distance = faceapi.euclideanDistance(
            new Float32Array(descriptor), 
            new Float32Array(savedFace.descriptor)
        );
        
        // 閾値0.3以下で、かつ今までの最小距離よりも小さい場合
        if (distance < 0.3 && distance < bestDistance) {
            bestDistance = distance;
            const employee = employees.find(emp => emp.id === savedFace.employeeId);
            if (employee) {
                bestMatch = employee;
            }
        }
    }
    
    return bestMatch;
}

function displayEmployeeName(employeeName, index) {
    const nameDisplay = document.getElementById('employee-name-display');
    
    // 既存のラベルをクリア
    nameDisplay.innerHTML = '';
    
    // 新しいラベルを作成
    const label = document.createElement('div');
    label.className = 'face-name-label';
    label.textContent = `${employeeName}さん`;
    
    nameDisplay.appendChild(label);
}

function drawFaceBoxes(video, detections) {
    const overlay = document.getElementById('face-overlay');
    overlay.innerHTML = '';
    
    const videoRect = video.getBoundingClientRect();
    
    detections.forEach(detection => {
        const box = detection.box;
        const faceBox = document.createElement('div');
        faceBox.className = 'face-box';
        
        const scaleX = videoRect.width / video.videoWidth;
        const scaleY = videoRect.height / video.videoHeight;
        
        faceBox.style.left = `${box.x * scaleX}px`;
        faceBox.style.top = `${box.y * scaleY}px`;
        faceBox.style.width = `${box.width * scaleX}px`;
        faceBox.style.height = `${box.height * scaleY}px`;
        
        overlay.appendChild(faceBox);
    });
}

function clearFaceOverlay() {
    const overlay = document.getElementById('face-overlay');
    overlay.innerHTML = '';

    const nameDisplay = document.getElementById('employee-name-display');
    if (nameDisplay) {
        nameDisplay.innerHTML = '';
    }
}

function updateFaceStatus(status) {
    const statusElement = document.getElementById('face-status');
    statusElement.textContent = status;
    statusElement.className = 'face-status' + (status.includes('検出: ') && !status.includes('なし') ? ' face-detected' : '');
}

function associateFaceWithEmployee(employeeId, scanTime) {
    const recentFaces = tempFaceDescriptors.filter(temp => 
        scanTime - temp.timestamp <= 10000
    );
    
    if (recentFaces.length > 0) {
        const latestFace = recentFaces.reduce((latest, current) => 
            current.timestamp > latest.timestamp ? current : latest
        );
        
        // 既存の特徴データを削除せず、新しいものを追加
        faceDescriptors.push({
            employeeId: employeeId,
            descriptor: latestFace.descriptor,
            timestamp: scanTime
        });
        
        // 同一ユーザーの特徴データが多すぎる場合は古いものを削除（最大5個まで）
        const userDescriptors = faceDescriptors.filter(face => face.employeeId === employeeId);
        if (userDescriptors.length > 5) {
            userDescriptors.sort((a, b) => a.timestamp - b.timestamp);
            const oldestDescriptor = userDescriptors[0];
            faceDescriptors = faceDescriptors.filter(face => 
                !(face.employeeId === employeeId && face.timestamp === oldestDescriptor.timestamp)
            );
        }
        
        saveData();
        console.log(`社員ID:${employeeId}の顔特徴を保存しました（現在${faceDescriptors.filter(f => f.employeeId === employeeId).length}個）`);
    } else {
        console.log('10秒以内の顔特徴が見つかりませんでした');
    }
}

// カメラ・スキャナー機能
function stopCamera() {
    stopFaceDetection();
    
    if (isQuaggaInitialized) {
        try {
            if (quaggaDetectionHandler) {
                Quagga.offDetected(quaggaDetectionHandler);
                quaggaDetectionHandler = null;
            }
            Quagga.stop();
            isQuaggaInitialized = false;
        } catch (e) {
            console.log('カメラ停止エラー:', e);
        }
    }
    
    if (currentMediaStream) {
        try {
            currentMediaStream.getTracks().forEach(track => {
                track.stop();
            });
            currentMediaStream = null;
        } catch (e) {
            console.log('MediaStream停止エラー:', e);
        }
    }
}

function initializeScanner() {
    if (isQuaggaInitialized) {
        stopCamera();
    }
    
    const scannerContainer = document.getElementById('scanner-container');
    
    const existingVideo = scannerContainer.querySelector('video');
    const existingCanvas = scannerContainer.querySelector('canvas');
    if (existingVideo) existingVideo.remove();
    if (existingCanvas) existingCanvas.remove();
    
    if (quaggaDetectionHandler) {
        Quagga.offDetected(quaggaDetectionHandler);
        quaggaDetectionHandler = null;
    }
    
    Quagga.init({
        inputStream: {
            name: "Live",
            type: "LiveStream",
            target: scannerContainer,
            constraints: {
                width: 640,
                height: 480,
                facingMode: "user"
            }
        },
        locator: {
            patchSize: "large",
            halfSample: false
        },
        numOfWorkers: 4,
        frequency: 3,
        decoder: {
            readers: ["code_128_reader", "code_39_reader"],
            debug: {
                drawBoundingBox: true,
                showFrequency: true,
                drawScanline: true,
                showPattern: true
            }
        },
        locate: true
    }, function(err) {
        if (err) {
            console.log(err);
            scannerContainer.innerHTML = '<p style="color: red; text-align: center; padding: 20px;">カメラを起動できませんでした<br><button onclick="initializeScanner()" style="margin-top: 10px; padding: 5px 15px;">再試行</button></p>';
            return;
        }
        Quagga.start();
        isQuaggaInitialized = true;
        
        try {
            const video = scannerContainer.querySelector('video');
            if (video && video.srcObject) {
                currentMediaStream = video.srcObject;
            }
        } catch (e) {
            console.log('MediaStream取得エラー:', e);
        }
        
        quaggaDetectionHandler = function(data) {
            const code = data.codeResult.code;
            const quality = data.codeResult.decodedCodes;
            console.log('バーコード検出:', code, '品質:', quality);
            
            if (!window.detectionBuffer) window.detectionBuffer = {};
            if (!window.detectionBuffer[code]) window.detectionBuffer[code] = 0;
            window.detectionBuffer[code]++;
            
            if (window.detectionBuffer[code] >= 2) {
                handleBarcodeScan(code);
                window.detectionBuffer = {};
            }
        };
        
        Quagga.onDetected(quaggaDetectionHandler);
    });
}

function handleBarcodeScan(code) {
    const now = Date.now();

    if (now - lastScanTime < 5000) {
        return;
    }
    lastScanTime = now;
    
    stopFaceDetection();
    
    const employeeId = code.trim();
    
    const employee = employees.find(emp => emp.id === employeeId);
    if (!employee) {
        playSound('error');
        showStatus(`社員ID「${employeeId}」が見つかりません`, 'error');
        setTimeout(() => {
            if (isFaceApiInitialized && document.getElementById('scanner').classList.contains('active')) {
                startFaceDetection();
            }
        }, 3000);
        return;
    }

    associateFaceWithEmployee(employeeId, now);

    currentEmployee = employee;
    const currentStatus = entranceStatus[employeeId] || 'out';
    const newStatus = currentStatus === 'in' ? 'out' : 'in';
    
    if (isExitReasonMode) {
        if (newStatus === 'out') {
            playSound('error');
            showStatus('退室理由を入力してください', 'error');
            setTimeout(() => {
                if (isFaceApiInitialized && document.getElementById('scanner').classList.contains('active')) {
                    startFaceDetection();
                }
            }, 3000);
            return;
        }
    }
    
    if (newStatus === 'in') {
        playSound('enter');
        entranceStatus[employeeId] = 'in';
        const greeting = getGreeting();
        showStatus(`${greeting}<br>${escapeHtml(employee.name)}さんが入室しました`, 'enter');
        addLog(employee, 'enter');
        saveData();
        
        setTimeout(() => {
            hideStatus();
            if (isFaceApiInitialized && document.getElementById('scanner').classList.contains('active')) {
                startFaceDetection();
            }
        }, 3000);
    } else {
        playSound('exit');
        showExitReasonInput();
    }
}

// UI制御機能
function showScreen(screenName, buttonElement) {
    stopCamera();
    
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    document.getElementById(screenName).classList.add('active');
    buttonElement.classList.add('active');
    
    if (screenName === 'scanner') {
        lastScanTime = 0;
        voiceTestMode = false;
        faceDetected = false;
        faceDescriptorExtracted = false;
        isExitReasonMode = false;
        
        setTimeout(() => {
            initializeScanner();
            if (isFaceApiInitialized) {
                startFaceDetection();
            }
        }, 100);
    } else if (screenName === 'employees') {
        renderEmployeeList();
    } else if (screenName === 'logs') {
        renderLogs();
    } else if (screenName === 'data') {
        // データ画面は特別な初期化不要
    }
}

function showExitReasonInput() {
    isExitReasonMode = true;
    stopFaceDetection();
    document.getElementById('exit-reason').classList.remove('hidden');
    document.getElementById('exit-reason-input').focus();
    document.getElementById('scanner-container').style.display = 'none';
}

function selectReason(reason) {
    if (currentEmployee) {
        entranceStatus[currentEmployee.id] = 'out';
        addLog(currentEmployee, 'exit', reason);
        saveData();
        
        const exitSoundPlayed = playExitReasonSound(reason);
        if (!exitSoundPlayed) {
            playSound('success');
        }
        
        showStatus(`${escapeHtml(currentEmployee.name)}さんが退室しました<br>理由: ${escapeHtml(reason)}`, 'exit');
        document.getElementById('exit-reason').classList.add('hidden');
        document.getElementById('exit-reason-input').value = '';
        isExitReasonMode = false;
        
        document.getElementById('scanner-container').style.display = 'block';
        
        setTimeout(() => {
            hideStatus();
            if (isFaceApiInitialized && document.getElementById('scanner').classList.contains('active')) {
                startFaceDetection();
            }
        }, 3000);
    }
}

function submitCustomReason() {
    const reason = document.getElementById('exit-reason-input').value.trim();
    
    if (currentEmployee) {
        entranceStatus[currentEmployee.id] = 'out';
        addLog(currentEmployee, 'exit', reason || '');
        saveData();
        
        playSound('success');
        const reasonText = reason ? `<br>理由: ${escapeHtml(reason)}` : '';
        showStatus(`${escapeHtml(currentEmployee.name)}さんが退室しました${reasonText}`, 'exit');
        document.getElementById('exit-reason').classList.add('hidden');
        document.getElementById('exit-reason-input').value = '';
        isExitReasonMode = false;
        
        document.getElementById('scanner-container').style.display = 'block';
        
        setTimeout(() => {
            hideStatus();
            if (isFaceApiInitialized && document.getElementById('scanner').classList.contains('active')) {
                startFaceDetection();
            }
        }, 3000);
    }
}

function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 10) return 'おはようございます';
    if (hour < 18) return 'お疲れ様です';
    return 'お疲れ様でした';
}

function showStatus(message, type) {
    const statusElement = document.getElementById('status-message');
    statusElement.innerHTML = `<div class="greeting">${message}</div>`;
    statusElement.className = `status-message status-${type}`;
    statusElement.classList.remove('hidden');
}

function hideStatus() {
    document.getElementById('status-message').classList.add('hidden');
}

// ログ管理機能
function addLog(employee, action, reason = '') {
    const log = {
        id: Date.now(),
        employeeId: employee.id,
        action: action,
        reason: reason,
        timestamp: new Date().toISOString()
    };
    
    logs.unshift(log);
    
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    logs = logs.filter(log => new Date(log.timestamp) > oneWeekAgo);
    
    renderLogs();
}

function renderLogs() {
    const recentLogsContainer = document.getElementById('recent-logs');
    const allLogsContainer = document.getElementById('all-logs');
    
    const recentLogs = logs.slice(0, 5);
    recentLogsContainer.innerHTML = recentLogs.map(log => createLogHTML(log)).join('');
    
    if (allLogsContainer) {
        allLogsContainer.innerHTML = logs.map(log => createLogHTML(log)).join('');
    }
}

function createLogHTML(log) {
    const employee = employees.find(emp => emp.id === log.employeeId);
    const employeeName = employee ? employee.name : `ID:${log.employeeId}`;
    const employeePhoto = employee ? employee.photo : null;
    
    const date = new Date(log.timestamp);
    const timeString = date.toLocaleString('ja-JP');
    const actionText = log.action === 'enter' ? '入室' : '退室';
    const actionClass = log.action === 'enter' ? 'log-enter' : 'log-exit';
    
    return `
        <div class="log-item ${actionClass}">
            <img src="${escapeHtml(employeePhoto || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiNERERERUUiLz4KPHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4PSI4IiB5PSI4Ij4KPHBhdGggZD0iTTEyIDEyQzE0LjIwOTEgMTIgMTYgMTAuMjA5MSAxNiA4QzE2IDUuNzkwODYgMTQuMjA5MSA0IDEyIDRDOS43OTA4NiA0IDggNS43OTA4NiA4IDhDOCAxMC4yMDkxIDkuNzkwODYgMTIgMTIgMTJaIiBmaWxsPSIjOTk5OTk5Ii8+CjxwYXRoIGQ9Ik0xMiAxNEM5LjMzIDE0IDQgMTUuMzQgNCAyMFYyMkgxNkgyMFYyMEMyMCAxNS4zNCAxNC42NyAxNCAxMiAxNFoiIGZpbGw9IiM5OTk5OTkiLz4KPC9zdmc+Cjwvc3ZnPgo=')}" 
                 alt="${escapeHtml(employeeName)}" class="log-avatar">
            <div class="log-info">
                <div class="log-name">${escapeHtml(employeeName)} - ${actionText}</div>
                <div class="log-time">${timeString}</div>
                ${log.reason ? `<div class="log-reason">理由: ${escapeHtml(log.reason)}</div>` : ''}
            </div>
        </div>
    `;
}

// 社員管理機能
function saveEmployee() {
    const id = document.getElementById('employee-id').value.trim();
    const name = document.getElementById('employee-name').value.trim();
    const photo = document.getElementById('employee-photo').value.trim();
    
    if (!id || !name) {
        playSound('error');
        alert('社員IDと名前は必須です');
        return;
    }
    
    if (currentEditingId !== null) {
        const index = employees.findIndex(emp => emp.id === currentEditingId);
        if (index !== -1) {
            employees[index] = { id, name, photo };
        }
        currentEditingId = null;
        document.getElementById('form-title').textContent = '新規社員登録';
        playSound('success');
    } else {
        if (employees.some(emp => emp.id === id)) {
            playSound('error');
            alert('同じIDの社員が既に存在します');
            return;
        }
        employees.push({ id, name, photo });
        playSound('success');
    }
    
    resetForm();
    renderEmployeeList();
    saveData();
}

function resetForm() {
    document.getElementById('employee-id').value = '';
    document.getElementById('employee-name').value = '';
    document.getElementById('employee-photo').value = '';
    currentEditingId = null;
    document.getElementById('form-title').textContent = '新規社員登録';
}

function editEmployee(id) {
    const employee = employees.find(emp => emp.id === id);
    if (employee) {
        document.getElementById('employee-id').value = employee.id;
        document.getElementById('employee-name').value = employee.name;
        document.getElementById('employee-photo').value = employee.photo || '';
        currentEditingId = id;
        document.getElementById('form-title').textContent = '社員情報編集';
    }
}

function deleteEmployee(id) {
    if (confirm('この社員を削除しますか？')) {
        employees = employees.filter(emp => emp.id !== id);
        delete entranceStatus[id];
        
        faceDescriptors = faceDescriptors.filter(face => face.employeeId !== id);
        
        renderEmployeeList();
        saveData();
        playSound('success');
    }
}

function renderEmployeeList() {
    const container = document.getElementById('employee-list');
    container.innerHTML = employees.map(employee => `
        <div class="employee-item">
            <img src="${escapeHtml(employee.photo || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjUiIGN5PSIyNSIgcj0iMjUiIGZpbGw9IiNERERERUUiLz4KPHN2ZyB3aWR0aD0iMzAiIGhlaWdodD0iMzAiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4PSIxMCIgeT0iMTAiPgo8cGF0aCBkPSJNMTIgMTJDMTQuMjA5MSAxMiAxNiAxMC4yMDkxIDE2IDhDMTYgNS43OTA4NiAxNC4yMDkxIDQgMTIgNEM5Ljc5MDg2IDQgOCA1Ljc5MDg2IDggOEM4IDEwLjIwOTEgOS43OTA4NiAxMiAxMiAxMloiIGZpbGw9IiM5OTk5OTkiLz4KPHBhdGggZD0iTTEyIDE0QzkuMzMgMTQgNCAzNS4zNCA0IDIwVjIySDE2SDIwVjIwQzIwIDE1LjM0IDE0LjY3IDE0IDEyIDE0WiIgZmlsbD0iIzk5OTk5OSIvPgo8L3N2Zz4KPC9zdmc+Cg==')}" 
                 alt="${escapeHtml(employee.name)}" class="employee-avatar">
            <div class="employee-info">
                <div><strong>ID:</strong> ${escapeHtml(employee.id)}</div>
                <div><strong>名前:</strong> ${escapeHtml(employee.name)}</div>
                <div><strong>ステータス:</strong> ${entranceStatus[employee.id] === 'in' ? '<span style="color: #059669;">在室</span>' : '<span style="color: #dc2626;">退室</span>'}</div>
            </div>
            <div class="employee-actions">
                <button class="btn btn-primary" onclick="editEmployee('${escapeHtml(employee.id)}')">編集</button>
                <button class="btn btn-danger" onclick="deleteEmployee('${escapeHtml(employee.id)}')">削除</button>
                <button class="btn btn-success" onclick="printEmployee('${escapeHtml(employee.id)}', '${escapeHtml(employee.name)}')">印刷</button>
                <button class="btn btn-info" onclick="downloadBarcode('${escapeHtml(employee.id)}')">バーコード</button>
            </div>
        </div>
    `).join('');
}

function printEmployee(employeeId, employeeName) {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 120;
    
    try {
        JsBarcode(canvas, employeeId, {
            format: "CODE128",
            width: 2,
            height: 80,
            displayValue: true,
            background: "#ffffff",
            lineColor: "#000000",
            margin: 10
        });
        
        const barcodeBase64 = canvas.toDataURL('image/png');
        
        const namecardData = {
            employeeId: employeeId,
            employeeName: employeeName,
            barcodeBase64: barcodeBase64
        };
        sessionStorage.setItem('namecardData', JSON.stringify(namecardData));
        
        let ifrm = document.createElement('iframe');
        ifrm.id = 'printFrame';
        ifrm.style.display = 'none';
        document.body.appendChild(ifrm);
        
        ifrm.onload = () => {
            ifrm.contentWindow.addEventListener('afterprint', e => {
                ifrm.remove();
                sessionStorage.removeItem('namecardData');
            });
            ifrm.contentWindow.print();
        };
        
        ifrm.src = "/namecard.html";
        
    } catch (e) {
        console.error('印刷用バーコード生成エラー:', e);
        alert('印刷用バーコードの生成に失敗しました');
    }
}

// データ管理機能
function exportData() {
    try {
        const exportData = {
            employees: employees,
            entranceStatus: entranceStatus,
            logs: logs,
            faceDescriptors: faceDescriptors,
            exportDate: new Date().toISOString(),
            version: "1.0"
        };
        
        const jsonString = JSON.stringify(exportData, null, 2);
        
        navigator.clipboard.writeText(jsonString).then(() => {
            document.getElementById('export-status').textContent = 'データをクリップボードにコピーしました！';
            setTimeout(() => {
                document.getElementById('export-status').textContent = '';
            }, 3000);
        }).catch(err => {
            console.error('クリップボードへのコピーに失敗:', err);
            document.getElementById('export-status').style.color = '#dc2626';
            document.getElementById('export-status').textContent = 'クリップボードへのコピーに失敗しました';
        });
        
    } catch (error) {
        console.error('データエクスポートエラー:', error);
        document.getElementById('export-status').style.color = '#dc2626';
        document.getElementById('export-status').textContent = 'エクスポートに失敗しました';
    }
}

function importData() {
    try {
        const jsonText = document.getElementById('import-data').value.trim();
        if (!jsonText) {
            document.getElementById('import-status').style.color = '#dc2626';
            document.getElementById('import-status').textContent = 'JSONデータを入力してください';
            return;
        }
        
        const importedData = JSON.parse(jsonText);
        
        if (!importedData.employees || !Array.isArray(importedData.employees)) {
            throw new Error('社員データが不正です');
        }
        if (!importedData.entranceStatus || typeof importedData.entranceStatus !== 'object') {
            throw new Error('入退室状況データが不正です');
        }
        if (!importedData.logs || !Array.isArray(importedData.logs)) {
            throw new Error('ログデータが不正です');
        }
        
        if (importedData.faceDescriptors && !Array.isArray(importedData.faceDescriptors)) {
            throw new Error('顔特徴データが不正です');
        }
        
        employees = importedData.employees;
        entranceStatus = importedData.entranceStatus;
        logs = importedData.logs;
        faceDescriptors = importedData.faceDescriptors || [];
        
        saveData();
        
        renderEmployeeList();
        renderLogs();
        
        document.getElementById('import-status').style.color = '#059669';
        document.getElementById('import-status').textContent = `データをインポートしました（社員数: ${employees.length}人）`;
        document.getElementById('import-data').value = '';
        
    } catch (error) {
        console.error('データインポートエラー:', error);
        document.getElementById('import-status').style.color = '#dc2626';
        document.getElementById('import-status').textContent = `インポートに失敗: ${error.message}`;
    }
}

function resetAllData() {
    if (!confirm('すべてのデータを削除しますか？\nこの操作は取り消すことができません。')) {
        return;
    }
    
    if (!confirm('本当にすべてのデータを削除しますか？\n社員情報、入退室状況、ログがすべて失われます。')) {
        return;
    }
    
    try {
        employees = [];
        entranceStatus = {};
        logs = [];
        faceDescriptors = [];
        
        localStorage.removeItem('employees');
        localStorage.removeItem('entranceStatus');
        localStorage.removeItem('logs');
        localStorage.removeItem('faceDescriptors');
        
        renderEmployeeList();
        renderLogs();
        
        document.getElementById('reset-status').textContent = 'すべてのデータを削除しました';
        setTimeout(() => {
            document.getElementById('reset-status').textContent = '';
        }, 3000);
        
    } catch (error) {
        console.error('データ削除エラー:', error);
        document.getElementById('reset-status').textContent = 'データ削除に失敗しました';
    }
}

function downloadBarcode(employeeId) {
    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 150;
    
    try {
        JsBarcode(canvas, employeeId, {
            format: "CODE128",
            width: 3,
            height: 100,
            displayValue: true,
            background: "#ffffff",
            lineColor: "#000000",
            margin: 20,
            fontSize: 20
        });
        
        canvas.toBlob(function(blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${employeeId}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 'image/png');
        
    } catch (e) {
        console.error('バーコード生成エラー:', e);
        alert('バーコードの生成に失敗しました');
    }
}