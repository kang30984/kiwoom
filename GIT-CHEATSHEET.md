# Git 명령어 정리

> `kang30984/kiwoom` 작업 기준. Windows PowerShell / 명령 프롬프트.
> 저장소 폴더: `C:\Users\chunjae\kiwoom-terminal-v30`

---

## 0. 결국 이 흐름의 반복

```
git pull  →  코드 수정  →  git status  →  git add .  →  git commit -m "..."  →  git push
```

작업 시작할 때 `pull`, 끝낼 때 `push`. 이것만 습관이 되면 나머지는 문제 생겼을 때 찾아보면 됩니다.

---

## 1. 매일 쓰는 4개

```powershell
git status              # 지금 뭐가 바뀌었나
git add .               # 전부 스테이징
git commit -m "메시지"   # 커밋
git push                # 원격에 올리기
```

`git push -u origin main`을 한 번 해뒀으면 이후엔 `git push`만으로 됩니다.

### 커밋 성공 확인 (중요)

`git commit` 직후 이 줄이 **반드시** 나와야 합니다.

```
[main 1a2b3c4] 메시지          ← 새 해시가 찍혀야 성공
 3 files changed, 45 insertions(+), 2 deletions(-)
```

이게 안 나오면 커밋이 안 된 것입니다. 에러처럼 보이지 않아서 성공한 줄 알기 쉬운 함정입니다.

| 대신 나온 메시지 | 원인 | 해결 |
|---|---|---|
| `nothing to commit, working tree clean` | 변경사항이 없음 | 정상. 올릴 게 없는 상태 |
| `Please tell me who you are` | 작성자 정보 미설정 | 아래 9번 참고 |
| 아무 출력 없이 끝남 | 에디터가 열렸다 닫힘 | `-m "메시지"`를 꼭 붙이기 |

### 특정 파일만 올리기

```powershell
git add server/src/routes/flow.js web/src/App.jsx
git add server/                  # 폴더 단위
git add -p                       # 변경 조각 단위로 골라 담기
```

---

## 2. 상태 확인

```powershell
git status -sb          # 한 줄 요약 (가장 자주 씀)
git log --oneline -5    # 최근 커밋 5개
git diff                # 아직 add 안 한 변경 내용
git diff --staged       # add 했지만 commit 안 한 내용
git diff --stat         # 파일별 줄 수만 요약
git remote -v           # 원격 주소 확인
git branch -a           # 브랜치 목록 (원격 포함)
git show HEAD           # 직전 커밋의 전체 내용
```

### `git status -sb` 첫 줄 읽는 법

| 출력 | 의미 | 할 일 |
|---|---|---|
| `## main...origin/main` | 원격과 동일 | 없음 |
| `## main...origin/main [ahead 2]` | 커밋 2개 안 올림 | `git push` |
| `## main...origin/main [behind 3]` | 원격이 3개 앞섬 | `git pull` |
| `## main...origin/main [ahead 1, behind 2]` | 갈라짐 | `git pull --rebase` |
| `## main` (뒤에 origin 없음) | 추적 브랜치 미설정 | `git push -u origin main` |

### `git log`에서 확인할 것

```
707c0a1 (HEAD -> main, origin/main) 메시지
        ~~~~~~~~~~~~~~~~~~~~~~~~~~
        HEAD와 origin/main이 같은 곳 → 로컬 = 원격, 푸시할 것 없음
```

`origin/main`이 아래쪽 커밋에 붙어 있으면 그만큼 안 올라간 것입니다.

---

## 3. 되돌리기 (위험도 낮은 순)

```powershell
git restore 파일명                  # 파일 수정 취소 (add 전)
git restore --staged 파일명          # add만 취소, 수정 내용은 유지
git restore .                       # 모든 수정 취소 ⚠
git commit --amend -m "새 메시지"    # 직전 커밋 메시지 수정 (push 전에만)
git reset --soft HEAD~1             # 직전 커밋 취소, 변경은 스테이징 상태로 유지
git reset --mixed HEAD~1            # 직전 커밋 취소, 변경은 남기고 add만 해제
git reset --hard HEAD               # 모든 로컬 수정 파괴 ⚠⚠ 복구 불가
```

> **`--hard` 쓰기 전에 항상 `git status`로 무엇이 사라질지 확인하세요.**
> 이미 push한 커밋을 `--amend`나 `reset`으로 고치면 원격과 갈라집니다. 혼자 쓰는 저장소면 `git push --force`로 밀 수 있지만, 남과 공유 중이면 `git revert`를 쓰세요.

```powershell
git revert 커밋해시      # 해당 커밋을 취소하는 새 커밋 생성 (히스토리 보존, 안전)
```

### 마지막 보험 — reflog

```powershell
git reflog                    # HEAD가 움직인 전체 기록
git reset --hard HEAD@{2}     # 그 시점으로 복귀
```

`--hard`로 날린 커밋도 대부분 여기서 찾을 수 있습니다. 커밋된 적 있는 내용이면 거의 살아납니다. (단, 커밋 안 한 수정은 복구 불가)

---

## 4. 원격에서 받아오기

```powershell
git pull                # 받아서 합치기
git fetch               # 받아만 오고 합치지 않음 (안전, 먼저 볼 때)
git pull --rebase       # 내 커밋을 원격 위로 올려 히스토리 정리
```

`fetch` 후 차이 확인:

```powershell
git fetch
git log HEAD..origin/main --oneline    # 원격에만 있는 커밋
git diff HEAD origin/main --stat       # 파일별 차이 요약
```

집·회사 등 두 곳에서 작업하면 **작업 시작 전에 항상 `git pull`** 부터 하세요.

---

## 5. 브랜치

```powershell
git switch -c feature/차트개선          # 새 브랜치 만들고 이동
git switch main                        # main으로 복귀
git switch -                           # 직전 브랜치로 토글
git merge feature/차트개선              # 현재 브랜치에 병합
git branch -d feature/차트개선          # 병합 끝난 브랜치 삭제
git push -u origin feature/차트개선     # 새 브랜치 원격에 올리기
git push origin --delete feature/차트개선  # 원격 브랜치 삭제
```

`kiwoom-terminal`처럼 이미 돌아가는 코드가 있으면 `main`에 직접 커밋하지 말고 브랜치에서 작업한 뒤 병합하는 편이 안전합니다.

```powershell
# 실무 흐름
git switch -c feature/체결강도-FID수정
# ... 작업 ...
git add . && git commit -m "체결강도 FID 실서버 값으로 교체"
git switch main
git pull
git merge feature/체결강도-FID수정
git push
git branch -d feature/체결강도-FID수정
```

### 작업 중 급하게 브랜치 옮겨야 할 때

```powershell
git stash               # 현재 변경사항 임시 보관
git switch main
# ... 급한 일 처리 ...
git switch -
git stash pop           # 보관한 변경사항 복구
git stash list          # 보관 목록
```

---

## 6. 저장소 연결

```powershell
git remote -v                                                    # 현재 주소 확인
git remote add origin https://github.com/kang30984/kiwoom.git     # 새로 연결
git remote set-url origin https://github.com/kang30984/kiwoom.git # 주소 변경
```

### 로컬 파일을 유지하면서 기존 원격에 연결

```powershell
git init -b main
git remote add origin https://github.com/kang30984/kiwoom.git
git fetch origin
git reset origin/main        # 작업 파일은 손대지 않고 기준만 맞춤
git status                   # 로컬과 원격의 차이 확인
```

`git reset origin/main`(--hard 없음)이 핵심입니다. 파일은 그대로 두고 기준선만 원격에 맞춥니다.

### 원격 것을 그대로 받아 새로 시작

```powershell
cd C:\Users\chunjae
git clone https://github.com/kang30984/kiwoom.git
```

---

## 7. 상황별 대처

### 푸시가 거부됨 — `rejected - fetch first`

```powershell
git pull --rebase origin main
git push
```

충돌이 나면 파일을 열어 `<<<<<<<` `=======` `>>>>>>>` 표시를 정리한 뒤:

```powershell
git add 충돌파일
git rebase --continue
```

되돌리고 싶으면 `git rebase --abort`.

### 파일을 바꿨는데 `nothing to commit`

`.gitignore`에 걸렸을 가능성이 높습니다.

```powershell
git check-ignore -v server/.env       # 어느 규칙에 걸렸는지 표시
```

### 커밋이 안 만들어짐

```powershell
git config user.name
git config user.email
```

비어 있으면 9번 참고.

### 100MB 넘는 파일로 푸시 실패

차트 데이터, CSV 덤프, `node_modules`가 원인인 경우가 많습니다.

```powershell
git rm --cached 큰파일명
echo 큰파일명 >> .gitignore
git commit -m "대용량 파일 제외"
git push
```

### 이미 커밋해버린 파일을 추적에서 빼기

```powershell
git rm --cached server/.env      # 로컬 파일은 남기고 git에서만 제거
git commit -m "env 파일 추적 제외"
```

### GitHub에 날짜가 안 바뀐 것처럼 보임

파일 목록의 `Last commit date`는 **그 파일을 마지막으로 수정한 커밋** 날짜입니다. 새 커밋이 그 폴더를 건드리지 않으면 그대로입니다. 정상 동작이므로 커밋 목록에서 확인하세요.

```
https://github.com/kang30984/kiwoom/commits/main
```

---

## 8. 보안 — 이것만은

### 커밋 전 확인

```powershell
git status               # 올라갈 파일 목록을 눈으로 확인
git diff --staged        # 실제 내용 확인
```

`server/.env`, `*.key`, `*.pem`이 목록에 보이면 **커밋하지 마세요.**

### 이미 키를 커밋해서 푸시했다면

1. **키움 오픈API에서 앱키·시크릿키를 즉시 재발급** ← 이게 최우선
2. 미국 시세 API 키도 재발급
3. 그 다음에 히스토리 정리

> 히스토리를 지워도 이미 노출된 값은 안전해지지 않습니다. 공개 저장소는 봇이 상시 스캔합니다. **재발급이 유일한 해결책입니다.**

### 현재 저장소 상태 (검증 완료)

- `.env.example`의 `KIWOOM_APP_KEY`, `KIWOOM_SECRET_KEY`, `US_API_KEY` 모두 빈 값 — 유출 없음
- `.gitignore`에 `.env`, `server/.env`, `*.pem`, `*.key` 포함
- 추적되는 env 파일은 `.env.example` 하나뿐

---

## 9. 한 번만 해두면 편한 설정

```powershell
git config --global user.name "kang30984"
git config --global user.email "GitHub에_등록한_이메일"

git config --global core.autocrlf true       # 윈도우 줄바꿈(CRLF) 문제 방지
git config --global core.quotepath false     # 한글 파일명 깨짐 방지
git config --global init.defaultBranch main
git config --global pull.rebase false        # pull 기본 동작 명시 (경고 제거)

git config --global alias.s "status -sb"
git config --global alias.l "log --oneline --graph -15"
git config --global alias.last "log -1 --stat"
```

이후 `git s`, `git l`, `git last`로 줄여 쓸 수 있습니다.
`core.quotepath false`는 한글 파일명이 `\355\225\234`처럼 보이는 것을 막아줍니다.

### 인증

GitHub는 비밀번호 인증을 지원하지 않습니다. **Personal Access Token**을 씁니다.

```
GitHub → Settings → Developer settings → Personal access tokens
→ Tokens (classic) → Generate new token → repo 권한 체크
```

발급된 토큰을 비밀번호 입력란에 붙여넣습니다. 한 번 저장해두려면:

```powershell
git config --global credential.helper manager
```

---

## 10. 이 프로젝트 실행 확인

원격에서 새로 받아 돌려볼 때:

```powershell
# 서버
cd server
npm ci
copy ..\.env.example .env
npm start                    # http://localhost:4000

# 새 터미널 — 웹
cd web
npm ci
npm run dev                  # http://localhost:5173
```

배포 후 파일이 제대로 올라갔는지 확인:

```powershell
node check-flow.js           # 저장소에 포함된 자체 검증 스크립트
```

기동 확인용 엔드포인트:

```
http://localhost:4000/api/health        → ver, demo 여부, 키 로드 여부
http://localhost:4000/api/flow/stats    → 어떤 api-id가 쓰이는지 (env / default 구분)
```

---

## 부록 — 자주 헷갈리는 것

| 명령 | 파일 | 스테이징 | 커밋 |
|---|---|---|---|
| `git restore 파일` | 되돌림 | — | — |
| `git restore --staged 파일` | 유지 | 해제 | — |
| `git reset --soft HEAD~1` | 유지 | 유지 | 취소 |
| `git reset --mixed HEAD~1` | 유지 | 해제 | 취소 |
| `git reset --hard HEAD~1` | **파괴** | 해제 | 취소 |

| 명령 | 원격 → 로컬 | 자동 병합 |
|---|---|---|
| `git fetch` | O | X |
| `git pull` | O | O |

`switch`는 브랜치 이동 전용, `restore`는 파일 복원 전용입니다. 예전 `checkout`이 둘 다 했는데 헷갈리기 쉬워 분리됐습니다.
