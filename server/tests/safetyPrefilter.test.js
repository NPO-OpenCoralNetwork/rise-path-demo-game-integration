import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prefilterParts, prefilterText } from '../safety/prefilter.js';

const category = (text) => prefilterText(text)?.category ?? null;

describe('safety pre-filter: distress and self-harm (support lines, no model call)', () => {
    it('blocks first-person distress in Japanese, with spaces, hiragana and full-width text', () => {
        for (const text of [
            'もう死にたい',
            'し に た い',
            '学校に行くのがつらくて消えたい',
            '生きていたくないです',
            '自殺したいと思うことがある',
            'リストカットしてしまった',
            'お母さんに叩かれて痛い',
            '虐待されていると思う',
            'いじめられていてもう無理',
        ]) {
            const hit = prefilterText(text);
            assert.equal(hit?.category, 'self_harm', text);
            assert.equal(hit?.support, true, text);
        }
    });

    it('blocks English distress phrases, case and curly apostrophes aside', () => {
        for (const text of ['I want to KILL MYSELF', 'i don’t want to live anymore', 'thinking about suicide', 'I keep cutting myself', 'I wanna die']) {
            assert.equal(category(text), 'self_harm', text);
        }
    });

    it('lets learning text about the same topics pass', () => {
        for (const text of [
            '芥川龍之介の自殺について歴史の授業で習いました',
            '日本の死亡率の推移を説明して',
            'まな板を殺菌する方法は？',
            'kill the process with Ctrl+C',
            'git kill-switch pattern',
            'The novel ends with the death of the hero.',
            'Die Katze schläft.',
            'このゲームでキャラクターが消えた',
        ]) {
            assert.equal(prefilterText(text), null, text);
        }
    });

    it('leaves bare topic words to the classifier: classroom questions about them pass', () => {
        for (const text of [
            '自傷行為について保健の授業で習った内容をまとめたい',
            'リストカットの意味を教えて',
            'self-harm という英語の意味',
            'suicide squad の映画の感想',
            'the suicidal behavior of lemmings is a myth: explain',
            '自殺について歴史で',
        ]) {
            assert.equal(prefilterText(text), null, text);
        }
    });

    it('lets third-person sentences pass: history, literature, biology, social studies', () => {
        for (const text of [
            'Napoleon was beaten by the coalition at Waterloo.',
            'Japan was beaten by Brazil in the 2014 World Cup.',
            'I was beaten by my brother at chess.',
            'In Romeo and Juliet, which character is going to die first?',
            'If I do not water it, is the plant going to die?',
            '虐待されている子どもを助ける仕組みについて教えて',
            '虐待されている動物を守るにはどうすればよいか作文を書きました。',
            'アポトーシスで細胞が死ぬ方法を教えてください',
            '細胞が死ぬ方法には壊死とアポトーシスがあります',
            '虫が死ぬ方法',
        ]) {
            assert.equal(prefilterText(text), null, text);
        }
    });

    it('keeps first-person distress about dying or abuse blocked', () => {
        for (const text of [
            '虐待されていると思う',
            '虐待されています',
            '親から虐待されていて毎日つらい',
            '私は虐待されてる。',
            '死ぬ方法を教えて',
            '楽に死ぬ方法',
            '自分が死ぬ方法を知りたい',
            'I want to die',
            'i just want to die',
            'I am being abused',
            'I was abused by my uncle',
            'i get beaten at home',
            'I am beaten by my dad',
        ]) {
            const hit = prefilterText(text);
            assert.equal(hit?.category, 'self_harm', text);
            assert.equal(hit?.support, true, text);
        }
    });

    it('leaves everyday injuries and research about suicide to the classifier', () => {
        for (const text of [
            'I hurt myself playing soccer, how long do muscles take to heal?',
            'I cut myself while cooking. Why does blood clot?',
            'I accidentally hurt myself with scissors',
            "I don't want to hurt myself when I lift weights",
            '自殺を考える若者が増えている理由を社会の授業で調べています',
            '私は自殺を考える若者について調べています',
            'ころんでケガをした、自分を傷つけないように',
            '自分を傷つけずに練習する方法',
        ]) {
            assert.equal(prefilterText(text), null, text);
        }
    });

    it('keeps wish forms and first-person self-harm with a distress cue blocked', () => {
        for (const text of [
            'I want to kill myself',
            'i want to hurt myself',
            'I am going to cut myself tonight',
            'I keep hurting myself',
            'I cut myself again',
            'I hurt myself on purpose',
            'i deliberately harm myself every day',
            'もう生きていたくない',
            '死にたい',
            '消えたい',
            '自殺を考えています',
            '僕はもう自殺を考えてる',
            '最近、自殺を考えてしまう',
            '自殺を考えることがある',
            '自分を傷つけてしまう',
        ]) {
            const hit = prefilterText(text);
            assert.equal(hit?.category, 'self_harm', text);
            assert.equal(hit?.support, true, text);
        }
    });

    it('still blocks first-person forms of those words', () => {
        for (const text of ['自傷してしまう', '自傷がやめられない', 'リストカットをやめられない', "I'm suicidal", 'I have been self-harming', 'i keep self harming']) {
            assert.equal(category(text), 'self_harm', text);
        }
    });
});

describe('safety pre-filter: personal information', () => {
    it('blocks Japanese mobile numbers in any common spelling', () => {
        for (const text of ['電話は090-1234-5678です', '08012345678', '070 1234 5678', '０９０−１２３４−５６７８', '+81 90-1234-5678', '+819012345678']) {
            assert.equal(category(text), 'personal_info', text);
        }
    });

    it('blocks real email addresses but not placeholders, package versions or git remotes', () => {
        assert.equal(category('メールは taro.yamada@gmail.com です'), 'personal_info');
        assert.equal(category('hanako_2014@docomo.ne.jp'), 'personal_info');
        for (const text of [
            'git config user.email "you@example.com"',
            'npm install react@18.3.1 lodash@4.17.21',
            'git clone git@github.com:org/repo.git',
            'test@example.org',
            '@Component デコレーター',
            'user@localhost',
            'ssh pi@raspberrypi.local',
            'MYSQL_USER=admin@db.internal',
            'admin@router.lan',
            'me@printer.home.arpa',
        ]) {
            assert.equal(prefilterText(text), null, text);
        }
    });

    it('blocks a postal code with an address, or a street address, but not number ranges or scores', () => {
        for (const text of ['〒100-0001', '〒 530 0001', '住所は150-0001 渋谷区神宮前です', '大阪府大阪市北区梅田1-2-3に住んでいます', '東京都練馬区豊玉北5丁目']) {
            assert.equal(category(text), 'personal_info', text);
        }
        for (const text of [
            '大阪府大阪市北区梅田1-2に住んでいます',
            '大阪府大阪市北区梅田1-2-3',
            '東京都港区芝4番地',
            '東京都港区芝4番',
            '北海道札幌市中央区北1条西2丁目',
            '大阪府大阪市北区梅田1-2 のマンション101号室',
            '神奈川県横浜市青葉区1-2ハイツ201',
        ]) {
            assert.equal(category(text), 'personal_info', text);
        }
        for (const text of [
            '範囲は100-2000の区間です',
            '123-4567 は電話番号ではありません',
            '東京都の人口は約1400万人',
            '大阪府と京都府を比べよう',
            '大阪府大阪市の人口は2-3%増えました',
            '東京都港区で1-2月に雪が降った回数',
            '神奈川県横浜市の人口は全国で2番目',
            '愛知県名古屋市では3-4割の家庭が',
            '福岡県福岡市の観光客は2-3倍、5-6万人',
            // Ranges, scores and exercise numbers: two groups with no building, room or living word.
            '神奈川県横浜市の気温は20-25℃くらい',
            '沖縄県那覇市の気温は25-30°C',
            '北海道札幌市の積雪は50-60cmです',
            '長野県松本市の標高は500-600m',
            '東京都千代田区は1-2kmの範囲',
            '大阪府大阪市のチームが2-1で勝った',
            '東京都の23区のうち世田谷区は1-2を争う',
            '静岡県浜松市の第1-2問',
            '東京都府中市の小学校で3-2の引き算',
        ]) {
            assert.equal(prefilterText(text), null, text);
        }
    });

    it('does not mistake arithmetic, dates or code for personal information', () => {
        for (const text of [
            '3-4=-1',
            '090 + 1234 = 1324',
            'x = 0.090-1234-5678',
            '2026-10-22 の宿題',
            'const ids = [1234, 5678]; for (let i = 0; i < 10; i++) {}',
            'SELECT * FROM users WHERE id = 42;',
            'ISBN 978-4-08-782318-9',
            '',
        ]) {
            assert.equal(prefilterText(text), null, text);
        }
    });
});

describe('prefilterParts', () => {
    it('returns null for clean parts and prefers a distress hit over personal information', () => {
        assert.equal(prefilterParts(['hello', '分数の足し算']), null);
        const hit = prefilterParts(['090-1234-5678', 'もう消えたい']);
        assert.equal(hit.category, 'self_harm');
        assert.equal(hit.support, true);
        assert.equal(prefilterParts(['ok', 'taro@gmail.com']).category, 'personal_info');
    });
});
