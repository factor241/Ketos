# Повторная проверка Claude for Open Source: возраст аккаунта и история Ketos

Дата проверки: 17 июля 2026 года  
Заявитель: законный резидент Финляндии  
Текущий GitHub-аккаунт: `ustyuzhaninkirillwhite-ui`  
Текущий репозиторий: `ustyuzhaninkirillwhite-ui/Ketas-Canvas-Mod-Main`

## 1. Исправленный итог

**Проект Ketos не обязан существовать два года.**

В актуальных юридических условиях Anthropic требование сформулировано так:

> “Have an existing GitHub account in good standing that is at least two years old.”

Следовательно:

- два года относятся к **GitHub-аккаунту физического лица**;
- два года не относятся к возрасту проекта;
- два года не относятся к возрасту конкретного репозитория;
- смена или перенос репозитория не обнуляет возраст старого GitHub-аккаунта;
- новый аккаунт не становится двухлетним из-за импорта старой Git-истории.

Официальный источник:
[Claude for Open Source Terms and Conditions, §2.3](https://www.anthropic.com/claude-for-oss-terms).

Публичная промостраница перечисляет основные треки, но не показывает все общие
требования. Полный набор обязательных требований находится именно в Terms and
Conditions. Вероятно, поэтому условие возраста аккаунта легко пропустить.

## 2. Что изменилось после уточнения пользователя

### 2.1 Регион

Финляндия присутствует в официальном списке стран, где доступен Claude:
[Where can I access Claude?](https://support.claude.com/en/articles/8461763-where-can-i-access-claude).

**Статус региона: PASS.**

### 2.2 Возраст проекта

Anthropic не устанавливает минимальный возраст Ketos. Новый репозиторий может
представлять старый проект, если заявитель честно показывает его историю,
миграции и свою роль.

**Статус возраста проекта: требования нет.**

### 2.3 Возраст текущего аккаунта

GitHub API сообщает, что `ustyuzhaninkirillwhite-ui` создан
3 марта 2026 года.

Если подаваться именно через этот аккаунт, требование двух лет будет выполнено
3 марта 2028 года.

**Статус текущего аккаунта: FAIL.**

Это самостоятельное общее требование. Ecosystem Impact Track позволяет
отступить от числовых критериев популярности, но условия не говорят, что он
отменяет §2.3.

## 3. Что подтверждено по текущей истории Ketos

### 3.1 Текущие GitHub-репозитории

В аккаунте обнаружены:

- `ketos-main`, созданный 13 июня 2026 года, private;
- `Ketas-Canvas-Mod-Main`, созданный 14 июля 2026 года, private.

Эти репозитории подтверждают текущую работу, но сами по себе не показывают
многолетнюю публичную историю проекта.

### 3.2 История Git

Текущий repository graph содержит корневые коммиты февраля 2023 года и старые
теги. Однако они принадлежат upstream-проекту Langflow и его авторам.
[`NOTICE`](./NOTICE) правильно указывает, что Ketos является независимой
неофициальной производной Langflow.

Ketos-specific изменения под текущей GitHub-идентичностью видны в июле
2026 года: локализация, rebrand, KFX, packaging, SDK, runtime и UI.

Это не означает, что пользователь не работал над проектом раньше. Это означает
только, что в доступных сейчас GitHub-данных не найдено публичного
доказательства более ранней самостоятельной истории Ketos.

### 3.3 Как доказать прежнюю историю

Если Ketos существовал в других репозиториях несколько лет, полезны:

- URL прежних GitHub-репозиториев;
- старый GitHub-аккаунт и дата его создания;
- commits, PR, issues и releases под старой идентичностью;
- старые package-registry releases;
- git tags и signed tags;
- архивные README и screenshots;
- Wayback Machine, Software Heritage или другие публичные snapshots;
- доменные записи и документация, ссылавшиеся на старые репозитории;
- таблица соответствия старых и новых commit SHA;
- объяснение причин миграции или переименования.

Возраст проекта полезен как контекст, но не заменяет требование возраста
аккаунта и доказательства ecosystem impact.

## 4. Варианты решения проблемы

### Вариант A — использовать принадлежащий вам старый GitHub-аккаунт

**Рекомендованный вариант.**

Если существует ваш личный GitHub-аккаунт старше двух лет:

1. Восстановить к нему доступ.
2. Проверить через GitHub API дату `created_at`.
3. Убедиться, что аккаунт находится в хорошем состоянии.
4. Обеспечить содержательную public open-source activity в течение 90 дней до
   подачи.
5. Оформить реальную maintainer-роль этого аккаунта в Ketos.
6. Подавать заявку, авторизуясь именно этим аккаунтом.

Terms не требуют, чтобы аккаунт обязательно был первоначальным владельцем
текущего repository URL. Заявитель может поддерживать или существенно
разрабатывать проект. Однако роль должна быть реальной и публично проверяемой.

#### Лучший вариант структуры

- создать GitHub organization для Ketos либо использовать существующую;
- перенести репозиторий в organization;
- добавить старый аккаунт как owner/maintainer;
- оставить текущий аккаунт как contributor/maintainer;
- публиковать releases, reviews и содержательные commits через реальную
  maintainer-идентичность;
- подаваться через старый аккаунт.

GitHub официально подтверждает, что transfer сохраняет Git-информацию,
issues, pull requests, releases, stars и redirects:
[Transferring a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository).

### Вариант B — объединить принадлежащие вам GitHub-аккаунты

GitHub описывает merge личных аккаунтов как перенос репозиториев в аккаунт,
который пользователь собирается сохранить:
[Merging multiple personal accounts](https://docs.github.com/en/account-and-profile/how-tos/account-management/merging-multiple-personal-accounts).

Если сохраняется старый аккаунт, его возраст остается подходящим, а
репозитории можно перенести на него.

Ограничения:

- permissions не переносятся автоматически;
- issues, PR и discussions не всегда переатрибутируются новому аккаунту;
- commits, созданные с GitHub `noreply` адресом другого аккаунта, нельзя
  перепривязать;
- обычные commit email можно добавить в сохраняемый аккаунт, если они
  действительно принадлежат вам.

Поэтому практичнее сохранить старый аккаунт, а не пытаться сделать новый
аккаунт «старым».

### Вариант C — восстановить старый аккаунт

Если аккаунт существовал, но доступ потерян:

- использовать password reset;
- recovery codes;
- passkey или security key;
- ранее подтвержденное устройство;
- SSH key или GitHub recovery flow.

Официальная инструкция:
[Recovering your account](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/recovering-your-account-if-you-lose-your-2fa-credentials).

GitHub предупреждает, что при отсутствии всех recovery methods Support не
всегда может восстановить 2FA-protected аккаунт. Поэтому этот путь зависит от
наличия реальных факторов восстановления.

### Вариант D — запросить у Anthropic письменное уточнение

Можно обратиться в Anthropic Support до подачи и кратко описать:

- заявитель проживает в Финляндии;
- проект существует давно;
- repository URL и GitHub-аккаунты менялись;
- текущий аккаунт новый;
- имеется документируемая история старого проекта;
- требуется понять, допускается ли account-migration exception.

Предлагаемый текст:

> I am the maintainer of Ketos, an open-source project whose repository has
> moved between GitHub locations over several years. My current GitHub account
> was created in March 2026, but I can provide the previous repository history,
> commit lineage, releases, and proof of my maintainer role. Section 2.3
> requires a GitHub account at least two years old. Does Anthropic accept
> verified account or repository migration evidence, or must the account used
> for OAuth itself be at least two years old?

Шанс исключения оценить невозможно. Формально Terms не предусматривают
автоматического освобождения от этого требования, поэтому ответ поддержки
нужен до отправки единственной заявки.

### Вариант E — ждать возраста текущего аккаунта

Если старого аккаунта нет или его невозможно восстановить, надежный формальный
путь — дождаться 3 марта 2028 года.

За это время можно:

- публично развивать Ketos;
- собирать внешних contributors;
- публиковать KFX packages;
- накапливать dependents и downloads;
- улучшать OpenSSF security posture;
- создавать releases и публичную contributor history.

Недостаток: программа может изменить условия или закрыться раньше.

## 5. Что не решает проблему

Не помогут и создадут риск дисквалификации:

- изменение дат Git commits;
- импорт старой истории только для имитации возраста;
- покупка или аренда чужого аккаунта;
- подача через аккаунт другого человека;
- фиктивное назначение maintainer без реальной работы;
- искусственные stars, contributors, downloads или dependents;
- выдача истории Langflow за личную историю Ketos;
- повторные дублирующие заявки.

Anthropic прямо оставляет за собой право отклонить заявку за misleading
information, account misuse и искусственное увеличение метрик.

## 6. Рекомендуемый план исправления

### Шаг 1 — найти старую идентичность

Составить перечень:

| Поле | Что указать |
| --- | --- |
| Старый GitHub username | Точный логин |
| URL профиля | Полная ссылка |
| Дата создания | `created_at` из GitHub API |
| Старые репозитории | URL каждого repo |
| Ketos commits | SHA и даты |
| Releases/tags | URL и версии |
| Использованные commit emails | Без публикации приватных адресов в отчете |
| Доступ к аккаунту | Есть / требуется recovery |

### Шаг 2 — выбрать канонический аккаунт

Если старый аккаунт принадлежит пользователю и доступен, сохранить его как
основной аккаунт для open-source деятельности и OAuth-заявки.

### Шаг 3 — сохранить непрерывность проекта

Не создавать еще один независимый GitHub-репозиторий. Лучше:

- transfer существующего repo;
- переименовать `Ketas-Canvas-Mod-Main` в понятное `ketos`;
- использовать автоматические redirects GitHub;
- сохранить commit graph и releases;
- архивировать прежние repo с указателем на новый canonical repo.

GitHub сохраняет redirects после rename:
[Renaming a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).

### Шаг 4 — подготовить публичный запуск

Перед сменой visibility:

1. Проверить secrets, private URLs, credentials и Actions logs.
2. Проверить юридическую атрибуцию Langflow.
3. Заменить `ketos.test` URLs и тестовые контакты.
4. Подготовить полноценные README, SECURITY, CONTRIBUTING и roadmap.
5. Создать `PROJECT_HISTORY.md`.
6. Опубликовать подписанный Ketos release.
7. Сделать репозиторий public.

GitHub предупреждает, что при переводе private repo в public код, commits и
Actions history становятся публичными:
[Setting repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).

### Шаг 5 — выполнить 90-day activity requirement

До заявки старый аккаунт должен иметь содержательную публичную активность за
последние 90 дней:

- commits в default branch;
- PR;
- code reviews;
- release.

Commit email должен быть связан с аккаунтом. GitHub описывает правила здесь:
[Profile contributions reference](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference).

### Шаг 6 — подаваться по Ecosystem Impact Track

Даже после решения account-age требования Ketos пока не достигает числовых
порогов Maintainer Track. Поэтому заявка остается дискреционной.

Нужно приложить проверяемые доказательства:

- прежние repo и миграционная история;
- реальная роль заявителя;
- публичный current repo;
- независимые пользователи;
- extensions и downstream use;
- внешние contributors;
- releases и maintenance activity;
- значение проекта для local-first, bilingual и extensible AI workflows.

## 7. Матрица готовности после повторной проверки

| Требование | Сейчас | Как исправить |
| --- | --- | --- |
| Резидент поддерживаемого региона | **PASS: Финляндия** | Ничего |
| Возраст проекта два года | **Не требуется** | Ничего |
| GitHub account >= 2 лет | **FAIL для текущего аккаунта** | Старый принадлежащий аккаунт или ожидание |
| Public activity за 90 дней | **FAIL** | Public repo + содержательная activity |
| OSI-approved project | **PARTIAL** | Опубликовать Ketos под MIT |
| Один из eligibility tracks | **FAIL сейчас** | Ecosystem Impact evidence либо числовой порог |
| Публично проверяемая роль | **FAIL/не видна** | Organization ownership, commits, reviews, releases |
| Честная история проекта | **PARTIAL** | `PROJECT_HISTORY.md` и ссылки на прежние repo |

## 8. Финальная оценка

Предыдущий общий вывод требует уточнения:

- утверждение «проект должен быть старше двух лет» — **неверно**;
- утверждение «GitHub-аккаунт заявителя должен быть старше двух лет» —
  **подтверждено текущими Terms**;
- Финляндия полностью снимает региональный блокер;
- многолетняя история проекта помогает заявке, но не меняет дату создания
  OAuth-аккаунта;
- если существует ваш старый GitHub-аккаунт старше двух лет, проблема
  потенциально решается без ожидания до 2028 года;
- после решения account-age остаются public activity и ecosystem impact.

**Рекомендуемый следующий шаг:** найти или восстановить старый GitHub-аккаунт,
проверить его `created_at`, затем перенести Ketos в organization и оформить
старый аккаунт как реального maintainer. Только после публичного запуска и
содержательной 90-day activity следует отправлять заявку.
