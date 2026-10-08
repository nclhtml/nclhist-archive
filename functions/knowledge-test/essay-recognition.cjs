const TOPIC = "question-type";

const LABELS = [
    "Explanatory—No stance",
    "Explanatory—Stance",
    "Trace and Explain",
    "Relative Importance—Single-factor",
    "Relative Importance—Dual-factors",
    "Compare—Plain: Similarities/Differences",
    "Compare—More than",
    "Turning Point",
    "Continuity/Change within Period",
    "Dual Question",
    "Rather Than"
];

const LABELS_ZH = [
    "直述題",
    "立場題",
    "追溯並解釋",
    "單項相對重要性",
    "雙項相對重要性",
    "比較：相似／不同",
    "比較：多於",
    "轉捩點",
    "延續／轉變",
    "雙問題",
    "而非"
];

const RULES = [
    [
        "Explain causes, effects, ways or obstacles without a required evaluative stance or ranking.",
        "解釋原因、影響、方式或障礙，毋須作出指定的評價立場或重要性排序。"
    ],
    [
        "Make an evaluative judgement using criteria, such as success, effectiveness, extent or adequacy.",
        "按準則作出評價，例如成功程度、成效、程度或是否足夠。"
    ],
    [
        "Follow development over time and explain why the changes occurred.",
        "按時間追溯發展，並解釋變化的原因。"
    ],
    [
        "Judge one named factor's importance against other relevant factors.",
        "把一項指定因素與其他相關因素比較，判斷其相對重要性。"
    ],
    [
        "Weigh the relative importance of two specified factors.",
        "比較兩項指定因素的相對重要性。"
    ],
    [
        "Compare the specified subjects using common criteria; identify relevant similarities and differences.",
        "按共同準則比較指定對象，指出相關的相似及不同之處。"
    ],
    [
        "Judge whether one side, effect or achievement outweighs the other.",
        "判斷某一方面、影響或成就是否多於或大於另一方。"
    ],
    [
        "Judge or explain a fundamental dividing point using developments before and after it.",
        "運用前後的發展，判斷或解釋某事件或年份是否構成根本性的分界。"
    ],
    [
        "Examine persistence, transformation or a trend across the specified period.",
        "考察指定時期內的延續、轉變或發展趨勢。"
    ],
    [
        "Address both substantive claims or tasks in the question.",
        "處理題目中的兩項實質論點或分析要求。"
    ],
    [
        "Assess the proposed characterisation or explanation expressed as one thing rather than another.",
        "評估題目以某一性質或解釋『而非』另一者作出的判斷。"
    ]
];

// Each row:
// English question | Chinese question | answer position |
// English analytical task | Chinese analytical task
//
// The supplied classifications are intentionally preserved.
const DATA = `
‘The alliance system was the main factor that turned tensions among the European powers into a general war in 1914.’ Do you agree? Explain your view with reference to European developments in the period 1900–14.|「同盟制度是把歐洲列強之間的緊張局勢轉化為1914年全面戰爭的主要因素。」你是否同意？參考1900–14年間歐洲的發展，解釋你的看法。|3|Judge the alliance system against other causes of general war.|把同盟制度與其他導致全面戰爭的因素比較，判斷其重要性。
Which was more important in undermining peace in Europe in the period 1919–39: weaknesses in the Paris Peace Settlement or weaknesses in the League of Nations? Explain your answer.|在1919–39年間，巴黎和約的弱點與國際聯盟的弱點，哪一者對破壞歐洲和平更為重要？解釋你的答案。|4|Weigh settlement weaknesses against League weaknesses as causes of unstable peace.|比較巴黎和約與國際聯盟的弱點對和平不穩的相對重要性。
Compare the Paris Peace Settlement and the settlements following the Second World War in terms of their treatment of Germany. Limit your discussion to the period 1919–49.|就對德國的處理而言，比較巴黎和約與第二次世界大戰後的和約安排。討論限於1919–49年。|5|Compare the treatment of Germany in two settlements.|比較兩次和約安排對德國的處理。
‘The policy of appeasement brought more harm than benefit to Europe in the 1930s.’ Comment on the validity of this statement.|「綏靖政策在1930年代對歐洲帶來的害處多於好處。」評論此說的有效性。|6|Weigh appeasement’s harm against its benefits.|衡量綏靖政策的害處是否多於好處。
How successful were attempts to establish collective security in Europe in the period 1919–39? Explain your view.|1919–39年間在歐洲建立集體安全的嘗試有多成功？解釋你的看法。|1|Judge the success of collective security.|評價建立集體安全的成功程度。
Examine the ways in which nationalism contributed to international tensions in Europe in the period 1900–14.|考察民族主義在1900–14年間如何加劇歐洲的國際緊張局勢。|0|Explain how nationalism contributed to tensions, without ranking it.|解釋民族主義如何加劇緊張局勢，毋須排列其重要性。
Trace and explain the development of relations between Germany and the Western European powers in the period 1919–39.|追溯並解釋1919–39年間德國與西歐列強關係的發展。|2|Describe and explain the development of Germany’s relations with Western powers.|按時間描述並解釋德國與西歐列強關係的發展。
To what extent was the end of the Second World War a turning point in the international position of the European powers? Explain your answer with reference to developments from the inter-war period to the end of the 1960s.|第二次世界大戰的結束在多大程度上是歐洲列強國際地位的轉捩點？參考兩次大戰之間至1960年代末的發展，解釋你的答案。|7|Judge whether WWII fundamentally changed European powers’ international position.|判斷第二次世界大戰是否根本改變了歐洲列強的國際地位。
‘The prospects for lasting peace in Europe deteriorated in the period 1919–39.’ To what extent do you agree? Explain your view with reference to developments within this period.|「歐洲實現持久和平的前景在1919–39年間惡化。」你在多大程度上同意？參考此時期內的發展，解釋你的看法。|8|Examine whether prospects for peace deteriorated across 1919–39.|考察1919–39年間和平前景是否呈惡化趨勢。
‘The Paris Peace Settlement attempted to uphold national self-determination, but its implementation created new national grievances.’ Do you agree? Explain your answer with reference to Europe in the period 1919–39.|「巴黎和約嘗試維護民族自決，但其實施卻造成新的民族不滿。」你是否同意？參考1919–39年間的歐洲，解釋你的答案。|9|Assess the attempt to uphold self-determination and the creation of grievances.|評估維護民族自決的嘗試，以及造成新的民族不滿這兩項論點。
‘The Paris Peace Settlement was an instrument of punishment rather than a foundation for reconciliation.’ Do you agree? Explain your view with reference to its terms and their consequences in Europe up to 1939.|「巴黎和約是懲罰的工具，而非和解的基礎。」你是否同意？參考其條款及截至1939年對歐洲的影響，解釋你的看法。|10|Assess punishment rather than reconciliation as a characterisation of the settlement.|評估以懲罰而非和解概括巴黎和約的性質是否恰當。
‘Economic difficulties were the principal reason for the failure of international peace-keeping efforts in Europe in the 1930s.’ Do you agree? Explain your answer.|「經濟困難是1930年代歐洲國際維持和平努力失敗的主要原因。」你是否同意？解釋你的答案。|3|Judge economic difficulties as the principal reason for peace-keeping failure.|把經濟困難與其他因素比較，判斷它是否維持和平失敗的主要原因。
To what extent had European countries learnt lessons from the First World War when they attempted to maintain peace in the period 1919–39? Explain your view.|歐洲國家在1919–39年間嘗試維持和平時，在多大程度上汲取了第一次世界大戰的教訓？解釋你的看法。|1|Evaluate whether countries learnt lessons from WWI.|評價歐洲國家是否汲取了第一次世界大戰的教訓。
Analyse the political, economic and social consequences of the Second World War for Europe. Limit your discussion to developments up to the end of the 1960s.|分析第二次世界大戰對歐洲的政治、經濟及社會影響。討論限於截至1960年代末的發展。|0|Explain political, economic and social consequences without a prescribed comparative judgment.|解釋政治、經濟及社會影響，毋須作出指定的比較判斷。
‘The Soviet Union’s policies towards Eastern Europe were the main cause of the emergence of the Cold War.’ Do you agree? Explain your view with reference to developments in the period 1945–55.|「蘇聯對東歐的政策是冷戰出現的主要原因。」你是否同意？參考1945–55年間的發展，解釋你的看法。|3|Judge Soviet Eastern European policies as the main cause of the Cold War.|把蘇聯對東歐的政策與其他因素比較，判斷其是否冷戰的主要成因。
Assess the relative importance of economic burdens and fear of nuclear war in bringing about détente between the USA and the USSR in the period 1962–79.|評估經濟負擔與對核戰的恐懼，在促成1962–79年間美蘇緩和關係方面的相對重要性。|4|Weigh economic burdens against fear of nuclear war as causes of détente.|比較經濟負擔與對核戰的恐懼對促成緩和關係的相對重要性。
Trace and explain changes in relations between the USA and the USSR in the period 1962–91.|追溯並解釋1962–91年間美國與蘇聯關係的變化。|2|Trace and explain changes in superpower relations.|按時間追溯並解釋超級大國關係的變化。
Compare the methods used by the USA and the USSR to maintain their influence in Europe during the period 1946–79.|比較1946–79年間美國與蘇聯維持其在歐洲影響力的方法。|5|Compare American and Soviet methods of maintaining influence.|比較美國與蘇聯維持影響力的方法。
‘Détente achieved more in reducing tensions than in resolving the underlying conflicts between the USA and the USSR.’ Do you agree? Explain your view with reference to the period 1962–79.|「緩和政策在減低美蘇緊張局勢方面的成就，多於解決兩國根本矛盾方面的成就。」你是否同意？參考1962–79年，解釋你的看法。|6|Compare détente’s achievement in reducing tensions with its achievement in resolving underlying conflicts.|比較緩和政策在減低緊張局勢及解決根本矛盾兩方面的成就。
To what extent was the Cuban Missile Crisis a turning point in relations between the USA and the USSR? Explain your view with reference to developments in the period 1946–79.|古巴導彈危機在多大程度上是美蘇關係的轉捩點？參考1946–79年間的發展，解釋你的看法。|7|Judge the Cuban Missile Crisis as a fundamental dividing point.|判斷古巴導彈危機是否構成美蘇關係的根本分界。
‘Military confrontation became less important in superpower relations in the period 1962–91.’ Do you agree? Explain your answer.|「軍事對抗在1962–91年間的超級大國關係中變得較不重要。」你是否同意？解釋你的答案。|8|Examine whether military confrontation became less important over time.|考察軍事對抗的重要性是否隨時間下降。
‘Nuclear weapons intensified the rivalry between the USA and the USSR, yet also discouraged direct war between them.’ Do you agree? Explain your view with reference to the period 1946–91.|「核武器加劇了美蘇競爭，但亦阻止兩國直接開戰。」你是否同意？參考1946–91年，解釋你的看法。|9|Assess nuclear weapons’ intensification of rivalry and discouragement of direct war.|評估核武器加劇競爭及阻止直接戰爭這兩項論點。
‘In the period 1946–91, the USA acted to contain Soviet influence rather than to expand its own influence.’ Do you agree? Justify your answer.|「1946–91年間，美國的行動旨在遏制蘇聯影響力，而非擴大自身影響力。」你是否同意？論證你的答案。|10|Assess containment rather than expansion as a characterisation of American policy.|評估以遏制而非擴張概括美國政策是否恰當。
Examine the ways in which the Cold War affected the political and economic development of Europe in the period 1946–91.|考察冷戰在1946–91年間如何影響歐洲的政治及經濟發展。|0|Explain political and economic effects on Europe.|解釋冷戰對歐洲的政治及經濟影響。
How effective were agreements between the USA and the USSR in controlling their rivalry in the period 1962–91? Explain your answer.|美蘇之間的協議在控制1962–91年間兩國競爭方面有多大成效？解釋你的答案。|1|Evaluate agreements’ effectiveness in controlling rivalry.|評價協議在控制競爭方面的成效。
‘Domestic weaknesses in the Soviet Union were the main cause of the end of the Cold War.’ Do you agree? Explain your view with reference to developments in the period 1979–91.|「蘇聯的內部弱點是冷戰結束的主要原因。」你是否同意？參考1979–91年間的發展，解釋你的看法。|3|Judge Soviet domestic weaknesses against other causes of the Cold War’s end.|把蘇聯內部弱點與其他導致冷戰結束的因素比較。
Analyse the political and economic considerations that encouraged Western European countries to pursue economic integration after the Second World War. Limit your discussion to the period 1945–2000.|分析促使西歐國家在第二次世界大戰後推動經濟統合的政治及經濟考慮。討論限於1945–2000年。|0|Explain political and economic considerations encouraging integration.|解釋促進經濟統合的政治及經濟考慮。
How successful was European economic integration in overcoming divisions among European countries in the period 1948–2000? Explain your answer.|歐洲經濟統合在克服1948–2000年間歐洲國家之間的分歧方面有多成功？解釋你的答案。|1|Evaluate integration’s success in overcoming divisions.|評價經濟統合在克服分歧方面的成功程度。
Trace and explain the development of economic integration in Western Europe from the establishment of the OEEC in 1948 to the establishment of the European Union in 1993.|追溯並解釋西歐經濟統合的發展，由1948年歐洲經濟合作組織成立至1993年歐洲聯盟成立。|2|Trace and explain the development of Western European integration.|按時間追溯並解釋西歐經濟統合的發展。
‘The desire to prevent another European war was the main driving force behind Western European economic integration.’ Do you agree? Explain your view with reference to the period 1945–2000.|「避免歐洲再次發生戰爭的願望，是西歐經濟統合的主要推動力。」你是否同意？參考1945–2000年，解釋你的看法。|3|Judge preventing another war as the main driving force.|把避免再次戰爭與其他因素比較，判斷其是否主要推動力。
Which was more important in promoting Western European economic integration in the period 1948–2000: political considerations or economic interests? Explain your view.|在促進1948–2000年間西歐經濟統合方面，政治考慮與經濟利益哪一者更為重要？解釋你的看法。|4|Weigh political considerations against economic interests.|比較政治考慮與經濟利益的相對重要性。
Compare the roles played by the USA and the USSR in the economic reconstruction of Europe in the period 1945–60.|比較美國與蘇聯在1945–60年間歐洲經濟重建中所扮演的角色。|5|Compare American and Soviet roles in European reconstruction.|比較美國與蘇聯在歐洲重建中的角色。
‘European economic integration brought more benefits than difficulties to participating countries in the period 1951–2000.’ Do you agree? Explain your view.|「歐洲經濟統合在1951–2000年間為參與國帶來的好處多於困難。」你是否同意？解釋你的看法。|6|Weigh integration’s benefits against its difficulties.|衡量經濟統合的好處是否多於困難。
‘Economic cooperation in Western Europe became increasingly extensive in both geographical coverage and areas of cooperation in the period 1948–2000.’ Do you agree? Justify your answer.|「西歐經濟合作在1948–2000年間，無論在地理涵蓋範圍或合作領域方面，均變得日益廣泛。」你是否同意？論證你的答案。|8|Examine increasing geographical and functional coverage over time.|考察地理涵蓋範圍及合作領域是否隨時間擴大。
‘The Cold War encouraged economic cooperation within each European bloc but obstructed economic cooperation between the two blocs.’ Do you agree? Explain your view with reference to the period 1945–91.|「冷戰促進了歐洲各集團內部的經濟合作，卻阻礙了兩大集團之間的經濟合作。」你是否同意？參考1945–91年，解釋你的看法。|5|Compare the Cold War’s effects on economic cooperation within and between the blocs.|比較冷戰對集團內部及集團之間經濟合作的影響。
‘International cooperation in environmental protection in the period 1970–2000 was characterised by declarations of intention rather than effective action.’ Do you agree? Explain your view.|「1970–2000年間的國際環境保護合作，其特徵是意向宣言，而非有效行動。」你是否同意？解釋你的看法。|10|Assess declarations rather than effective action as a characterisation of environmental cooperation.|評估以意向宣言而非有效行動概括環保合作是否恰當。
Assess the effectiveness of international organisations in dealing with medical and public-health problems in the second half of the twentieth century.|評估國際組織在二十世紀下半葉處理醫療及公共衞生問題的成效。|1|Evaluate effectiveness in addressing medical and public-health problems.|評價處理醫療及公共衞生問題的成效。
Examine the obstacles to international cooperation in dealing with population and resources problems in the second half of the twentieth century.|考察二十世紀下半葉國際合作在處理人口及資源問題方面所遇到的障礙。|0|Explain obstacles to cooperation on population and resources.|解釋人口及資源問題方面的合作障礙。
To what extent had Japan developed a democratic political system by the end of the 1920s? Explain your answer with reference to developments in the first three decades of the twentieth century.|截至1920年代末，日本在多大程度上發展了民主政治制度？參考二十世紀首三十年的發展，解釋你的答案。|1|Judge Japan against criteria for a democratic political system.|按民主政治制度的準則評價日本。
‘The weaknesses of party government were the main cause of the rise of militarism in Japan in the 1930s.’ Do you agree? Explain your view with reference to the period 1918–37.|「政黨政府的弱點是1930年代日本軍國主義興起的主要原因。」你是否同意？參考1918–37年，解釋你的看法。|3|Judge party-government weaknesses against other causes of militarism.|把政黨政府的弱點與其他軍國主義興起的原因比較。
Which was more important in encouraging Japanese military expansion in the period 1931–41: economic difficulties or nationalist ambitions? Explain your view.|在促使1931–41年間日本軍事擴張方面，經濟困難與民族主義野心哪一者更為重要？解釋你的看法。|4|Weigh economic difficulties against nationalist ambitions as causes of expansion.|比較經濟困難與民族主義野心對擴張的相對重要性。
Compare the political systems of Japan in the 1920s and the 1950s in terms of the distribution of political power and opportunities for popular participation.|就政治權力分配及民眾參與機會而言，比較日本在1920年代與1950年代的政治制度。|5|Compare political systems in the 1920s and 1950s using common criteria.|按共同準則比較1920年代及1950年代的政治制度。
‘Japan’s foreign expansion brought more losses than gains to the country in the period 1931–45.’ Do you agree? Explain your view.|「日本的對外擴張在1931–45年間為國家帶來的損失多於得益。」你是否同意？解釋你的看法。|6|Weigh losses against gains from foreign expansion.|衡量對外擴張的損失是否多於得益。
Trace and explain Japan’s economic recovery and growth from 1945 to the end of the 1960s.|追溯並解釋日本由1945年至1960年代末的經濟復甦及增長。|2|Trace and explain economic recovery and growth.|按時間追溯並解釋經濟復甦及增長。
To what extent did the Allied occupation represent a turning point in Japan’s political and social development? Explain your answer with reference to the period from the 1920s to the end of the 1960s.|盟軍佔領在多大程度上是日本政治及社會發展的轉捩點？參考1920年代至1960年代末，解釋你的答案。|7|Judge whether occupation fundamentally changed political and social development.|判斷盟軍佔領是否根本改變了政治及社會發展。
‘Japan became increasingly active in its relations with other Asian countries in the period 1952–2000.’ Do you agree? Explain your view.|「日本在1952–2000年間與其他亞洲國家的交往變得日益積極。」你是否同意？解釋你的看法。|8|Examine whether Japan became increasingly active in Asian relations.|考察日本對亞洲交往是否呈日益積極的趨勢。
‘The Allied occupation weakened traditional sources of power in Japan while creating foundations for its post-war development.’ Do you agree? Explain your answer with reference to the period 1945–69.|「盟軍佔領削弱了日本的傳統權力來源，同時為其戰後發展建立基礎。」你是否同意？參考1945–69年，解釋你的答案。|9|Assess the weakening of traditional power and the creation of foundations for development.|評估削弱傳統權力及建立發展基礎這兩項論點。
‘Japan’s relations with other Asian countries in the period 1952–2000 were characterised by economic cooperation rather than political reconciliation.’ Do you agree? Justify your answer.|「1952–2000年間日本與其他亞洲國家的關係，其特徵是經濟合作，而非政治和解。」你是否同意？論證你的答案。|10|Assess economic cooperation rather than political reconciliation as the principal characterisation.|評估以經濟合作而非政治和解概括關係是否恰當。
Examine the obstacles to the improvement of relations between Japan and the People’s Republic of China in the period 1949–2000.|考察1949–2000年間日本與中華人民共和國改善關係所遇到的障礙。|0|Explain obstacles to improved Sino-Japanese relations.|解釋改善中日關係的障礙。
‘The efforts of the Japanese government were the main reason for Japan’s economic growth in the period 1952–69.’ Do you agree? Explain your view.|「日本政府的努力是1952–69年間日本經濟增長的主要原因。」你是否同意？解釋你的看法。|3|Judge government efforts against other causes of economic growth.|把政府的努力與其他經濟增長因素比較。
Examine the ways in which the Late Qing Reform attempted to strengthen China in the period 1901–12.|考察晚清改革在1901–12年間如何嘗試增強中國的實力。|0|Explain how Late Qing reforms attempted to strengthen China.|解釋晚清改革如何嘗試增強中國實力。
How successful was the Nanjing Nationalist Government in modernising China in the period 1928–37? Explain your view with reference to political and economic developments.|南京國民政府在1928–37年間推動中國現代化有多成功？參考政治及經濟發展，解釋你的看法。|1|Evaluate the Nanjing government’s success in modernisation.|評價南京國民政府推動現代化的成功程度。
Trace and explain changes in the strategy of the Chinese Communist Party in pursuing revolution in the period 1921–49.|追溯並解釋中國共產黨在1921–49年間推行革命策略的變化。|2|Trace and explain changes in Communist revolutionary strategy.|按時間追溯並解釋共產黨革命策略的變化。
‘Changes in ideas were the main contribution of the May Fourth Movement to China’s modernisation.’ Do you agree? Explain your answer with reference to developments up to 1937.|「思想的轉變是五四運動對中國現代化的主要貢獻。」你是否同意？參考截至1937年的發展，解釋你的答案。|3|Judge intellectual change as the May Fourth Movement’s main contribution.|把思想轉變與其他貢獻比較，判斷其是否五四運動的主要貢獻。
Assess the relative importance of domestic economic reform and opening-up to the outside world in promoting China’s economic modernisation in the period 1978–2000.|評估國內經濟改革與對外開放，在促進1978–2000年間中國經濟現代化方面的相對重要性。|4|Weigh domestic reform against opening-up as contributors to economic modernisation.|比較國內改革與對外開放對經濟現代化的相對重要性。
Compare the Late Qing Reform and the reforms of the Nanjing Nationalist Government in terms of their political aims and methods.|就政治目標及方法而言，比較晚清改革與南京國民政府的改革。|5|Compare the political aims and methods of two reform programmes.|比較兩項改革計劃的政治目標及方法。
‘Mao Zedong’s attempts at economic modernisation brought more setbacks than achievements to China in the period 1949–76.’ Do you agree? Explain your view.|「毛澤東推動經濟現代化的嘗試，在1949–76年間為中國帶來的挫折多於成就。」你是否同意？解釋你的看法。|6|Weigh setbacks against achievements in Maoist economic modernisation.|衡量毛澤東時期經濟現代化的挫折是否多於成就。
To what extent was 1978 a turning point in China’s approach to economic modernisation? Explain your view with reference to developments in the period 1953–2000.|1978年在多大程度上是中國經濟現代化方針的轉捩點？參考1953–2000年間的發展，解釋你的看法。|7|Judge 1978 as a fundamental change in economic approach.|判斷1978年是否代表經濟方針的根本轉變。
‘China’s methods of economic development underwent fundamental transformation in the period 1978–2000.’ Do you agree? Explain your answer.|「中國的經濟發展方法在1978–2000年間經歷了根本轉變。」你是否同意？解釋你的答案。|8|Examine transformation within 1978–2000.|考察1978–2000年這段時期內的轉變。
‘The 1911 Revolution transformed China’s political institutions but failed to establish a stable political order.’ Do you agree? Explain your view with reference to developments in the period 1911–27.|「辛亥革命改變了中國的政治制度，卻未能建立穩定的政治秩序。」你是否同意？參考1911–27年間的發展，解釋你的看法。|9|Assess institutional transformation and failure to establish political stability.|評估制度轉變及未能建立政治穩定這兩項論點。
‘China’s economic modernisation in the Maoist period was guided by ideological commitment rather than practical considerations.’ Do you agree? Explain your view with reference to the period 1953–76.|「毛澤東時期中國的經濟現代化，是由意識形態信念而非實際考慮所引導。」你是否同意？參考1953–76年，解釋你的看法。|10|Assess ideological commitment rather than practical considerations.|評估以意識形態信念而非實際考慮解釋經濟方針是否恰當。
Examine the impact of the Cultural Revolution on China’s political, economic and cultural development in the period 1966–76.|考察文化大革命對1966–76年間中國政治、經濟及文化發展的影響。|0|Explain the Cultural Revolution’s political, economic and cultural impact.|解釋文化大革命的政治、經濟及文化影響。
How successful were China’s efforts to improve relations with other Asian countries in the period 1978–2000? Explain your answer.|中國在1978–2000年間改善與其他亞洲國家關係的努力有多成功？解釋你的答案。|1|Evaluate success in improving relations with Asian countries.|評價改善與亞洲國家關係的成功程度。
Examine the continuity of China’s efforts to develop a socialist economy in the period 1953–78, with reference to the different economic programmes adopted during this period.|參考1953–78年間推行的不同經濟計劃，考察中國發展社會主義經濟的努力所呈現的延續性。|8|Examine the persistence of socialist economic development efforts across different programmes.|考察不同計劃之間，發展社會主義經濟的努力如何延續。
Examine the ways in which population changes affected Hong Kong’s economic and social development in the period 1945–80.|考察人口變化在1945–80年間如何影響香港的經濟及社會發展。|0|Explain population changes’ economic and social effects.|解釋人口變化的經濟及社會影響。
How successful was the Hong Kong government in responding to the social problems associated with industrialisation and urbanisation in the period 1950–80? Explain your view.|香港政府在1950–80年間應對工業化及城市化所引起的社會問題有多成功？解釋你的看法。|1|Evaluate government responses to social problems.|評價政府應對社會問題的成效。
Trace and explain changes in the participation of Chinese people in Hong Kong’s administration in the period 1945–97.|追溯並解釋1945–97年間華人參與香港管治的變化。|2|Trace and explain Chinese participation in administration.|按時間追溯並解釋華人參與管治的變化。
‘Developments in mainland China were the main factor shaping Hong Kong’s economic development in the first half of the twentieth century.’ Do you agree? Explain your answer.|「中國內地的發展是影響二十世紀上半葉香港經濟發展的主要因素。」你是否同意？解釋你的答案。|3|Judge mainland developments against other economic influences.|把內地發展與其他經濟影響因素比較。
Assess the relative importance of developments in mainland China and international circumstances in promoting Hong Kong’s industrialisation from the 1950s to the 1970s.|評估中國內地的發展與國際形勢，在促進香港由1950年代至1970年代工業化方面的相對重要性。|4|Weigh mainland developments against international circumstances as causes of industrialisation.|比較內地發展與國際形勢對工業化的相對重要性。
Compare the roles of Chinese leaders and Chinese organisations in Hong Kong’s administration in the periods 1900–41 and 1945–67.|比較1900–41年與1945–67年兩個時期，華人領袖及華人組織在香港管治中的角色。|5|Compare administrative roles in two specified periods.|比較兩個指定時期的管治角色。
‘Urbanisation brought more improvements than problems to the lives of Hong Kong people in the period 1950–97.’ Do you agree? Explain your answer.|「城市化在1950–97年間為香港居民生活帶來的改善多於問題。」你是否同意？解釋你的答案。|6|Weigh urbanisation’s improvements against its problems.|衡量城市化帶來的改善是否多於問題。
To what extent was 1967 a turning point in the relationship between the Hong Kong government and the local population? Explain your answer with reference to developments in the period 1945–97.|1967年在多大程度上是香港政府與本地居民關係的轉捩點？參考1945–97年間的發展，解釋你的答案。|7|Judge whether 1967 fundamentally changed government–population relations.|判斷1967年是否根本改變了政府與居民的關係。
‘Hong Kong’s role in the economy of the Asia-Pacific Rim became increasingly diversified in the period 1971–97.’ Do you agree? Explain your answer.|「香港在亞太區經濟中的角色於1971–97年間變得日益多元化。」你是否同意？解釋你的答案。|8|Examine increasing diversification of Hong Kong’s regional economic role.|考察香港區域經濟角色日益多元化的趨勢。
‘Closer economic links with mainland China encouraged Hong Kong’s economic growth, while Hong Kong also contributed to the mainland’s economic development.’ Elaborate on this statement with reference to the period 1978–97.|「與中國內地更緊密的經濟聯繫促進了香港的經濟增長，而香港亦對內地的經濟發展作出貢獻。」參考1978–97年，闡述此說。|9|Explain mainland contributions to Hong Kong and Hong Kong’s contributions to the mainland.|解釋內地對香港，以及香港對內地的兩方面貢獻。
‘Hong Kong’s cultural development in the twentieth century was characterised by the preservation of Chinese traditions rather than the adoption of foreign influences.’ Do you agree? Explain your answer with reference to developments up to 1997.|「香港在二十世紀的文化發展，其特徵是保留中國傳統，而非吸收外來影響。」你是否同意？參考截至1997年的發展，解釋你的答案。|10|Assess preservation of Chinese traditions rather than adoption of foreign influences.|評估以保留中國傳統而非吸收外來影響概括文化發展是否恰當。
‘The question of Hong Kong’s future was the main factor shaping its political development in the period 1980–97.’ Do you agree? Explain your view.|「香港前途問題是影響1980–97年間香港政治發展的主要因素。」你是否同意？解釋你的看法。|3|Judge the question of Hong Kong’s future against other political influences.|把香港前途問題與其他政治影響因素比較。
‘The weakening of European colonial powers was the principal cause of decolonisation in Southeast Asia after the Second World War.’ Do you agree? Explain your view with reference to two Southeast Asian countries.|「歐洲殖民列強的衰弱，是第二次世界大戰後東南亞非殖民地化的主要原因。」你是否同意？參考兩個東南亞國家，解釋你的看法。|3|Judge European colonial weakening against other causes of decolonisation.|把歐洲殖民列強衰弱與其他非殖民地化的原因比較。
Assess the relative importance of local nationalist movements and changes in international circumstances in bringing about independence in two Southeast Asian countries after the Second World War.|評估本地民族主義運動與國際形勢變化，在促成第二次世界大戰後兩個東南亞國家獨立方面的相對重要性。|4|Weigh nationalist movements against international circumstances.|比較民族主義運動與國際形勢的相對重要性。
Select two Southeast Asian countries and compare the methods used by their nationalist movements to achieve independence after the Second World War.|選取兩個東南亞國家，比較其民族主義運動在第二次世界大戰後爭取獨立的方法。|5|Compare independence methods in two countries.|比較兩個國家爭取獨立的方法。
‘ASEAN was more successful in promoting economic cooperation than political cooperation in the period 1967–2000.’ Do you agree? Explain your answer.|「東盟在1967–2000年間促進經濟合作，比促進政治合作更為成功。」你是否同意？解釋你的答案。|6|Compare ASEAN’s degree of success in economic and political cooperation.|比較東盟在經濟及政治合作兩方面的成功程度。
How effective were international efforts in ending apartheid in South Africa in the period 1960–94? Explain your view.|國際努力在結束1960–94年間南非種族隔離制度方面有多大成效？解釋你的看法。|1|Evaluate international efforts to end apartheid.|評價國際努力在結束種族隔離制度方面的成效。
Examine the ways in which apartheid affected relations among racial groups in South Africa in the second half of the twentieth century.|考察種族隔離制度在二十世紀下半葉如何影響南非各種族之間的關係。|0|Explain apartheid’s effects on racial relations.|解釋種族隔離制度對種族關係的影響。
Trace and explain the development of Arab–Israeli relations in the period 1948–79.|追溯並解釋1948–79年間阿拉伯國家與以色列關係的發展。|2|Trace and explain Arab–Israeli relations.|按時間追溯並解釋阿以關係的發展。
To what extent was the establishment of Israel in 1948 a turning point in relations between Jews and Arabs in Palestine? Explain your view with reference to developments in the period 1945–79.|1948年以色列成立，在多大程度上是巴勒斯坦境內猶太人與阿拉伯人關係的轉捩點？參考1945–79年間的發展，解釋你的看法。|7|Judge Israel’s establishment as a fundamental change in Jewish–Arab relations.|判斷以色列成立是否根本改變了猶太人與阿拉伯人的關係。
‘Regional cooperation in Southeast Asia became increasingly extensive in the period 1967–2000.’ Do you agree? Explain your answer with reference to ASEAN’s development.|「東南亞區域合作在1967–2000年間變得日益廣泛。」你是否同意？參考東盟的發展，解釋你的答案。|8|Examine the increasing extent of Southeast Asian regional cooperation.|考察東南亞區域合作日益擴展的趨勢。
‘Foreign intervention intensified the Arab–Israeli conflict but also created opportunities for peace.’ Do you agree? Explain your view with reference to the period 1948–2000.|「外國干預加劇了阿以衝突，但亦創造了和平機會。」你是否同意？參考1948–2000年，解釋你的看法。|9|Assess foreign intervention’s intensification of conflict and creation of peace opportunities.|評估外國干預加劇衝突及創造和平機會這兩項論點。
‘Progress towards ending apartheid in South Africa resulted from negotiation rather than confrontation.’ Do you agree? Explain your view with reference to the period 1960–94.|「南非結束種族隔離制度的進展，源於談判而非對抗。」你是否同意？參考1960–94年，解釋你的看法。|10|Assess negotiation rather than confrontation as the explanation for progress.|評估以談判而非對抗解釋進展是否恰當。
‘Nationalism was the main cause of racial conflicts in the Balkans in the period 1980–99.’ Do you agree? Explain your view.|「民族主義是1980–99年間巴爾幹地區種族衝突的主要原因。」你是否同意？解釋你的看法。|3|Judge nationalism against other causes of Balkan conflicts.|把民族主義與其他巴爾幹衝突的成因比較。
How effective was the United Nations in promoting peace between Israel and the Arab states in the period 1947–91? Explain your answer.|聯合國在促進1947–91年間以色列與阿拉伯國家之間的和平方面有多大成效？解釋你的答案。|1|Evaluate UN effectiveness in promoting Arab–Israeli peace.|評價聯合國促進阿以和平的成效。
Examine the obstacles to international efforts to settle racial conflicts in the Balkans in the period 1980–99.|考察1980–99年間國際社會解決巴爾幹地區種族衝突所遇到的障礙。|0|Explain obstacles to settling Balkan conflicts.|解釋解決巴爾幹衝突的障礙。
Select one country within your History curriculum and examine the ways in which economic development strengthened its international influence in the second half of the twentieth century.|選取歷史課程內的一個國家，考察經濟發展在二十世紀下半葉如何增強其國際影響力。|0|Explain how economic development strengthened international influence.|解釋經濟發展如何增強國際影響力。
‘Economic growth alone was insufficient to make a country modernised.’ To what extent do you agree? Explain your answer with reference to one country within your History curriculum during a clearly specified period of the twentieth century.|「單靠經濟增長不足以使一個國家實現現代化。」你在多大程度上同意？參考歷史課程內的一個國家，並明確指定二十世紀的一段時期，解釋你的答案。|1|Evaluate whether economic growth alone satisfied the requirements of modernisation.|評價單靠經濟增長是否符合現代化的要求。
‘Government leadership was the main driving force behind successful economic reconstruction after the Second World War.’ Do you agree? Explain your answer with reference to either Japan or Western Europe, limiting your discussion to the period 1945–70.|「政府領導是第二次世界大戰後經濟重建取得成功的主要推動力。」你是否同意？參考日本或西歐，解釋你的答案；討論限於1945–70年。|3|Judge government leadership against other causes of successful reconstruction.|把政府領導與其他促成成功重建的因素比較。
Compare the methods used by the League of Nations and the United Nations to maintain peace. Use examples from the periods 1919–39 and 1945–2000 respectively.|比較國際聯盟與聯合國維持和平的方法，分別運用1919–39年及1945–2000年的例子。|5|Compare League of Nations and UN peace-maintenance methods.|比較國際聯盟與聯合國維持和平的方法。
‘In the twentieth century, nationalism contributed more to conflict than to cooperation.’ Do you agree? Explain your view using historical examples from both Themes A and B of your History curriculum.|「在二十世紀，民族主義對衝突的促進多於對合作的促進。」你是否同意？運用歷史課程主題甲及主題乙的歷史例子，解釋你的看法。|6|Weigh nationalism’s contribution to conflict against its contribution to cooperation.|衡量民族主義對衝突的促進是否多於對合作的促進。
Select either 1945 or 1991 and explain why it could be regarded as a turning point in the development of international cooperation. Support your answer with examples within your History curriculum, and limit your discussion to the twentieth century.|選取1945年或1991年，解釋為何該年可被視為國際合作發展的轉捩點。運用歷史課程內的例子支持答案，討論限於二十世紀。|7|Explain the selected year’s significance as a fundamental dividing point.|解釋所選年份作為根本分界的意義。
‘The second half of the twentieth century witnessed a movement from external domination towards greater autonomy.’ Illustrate this statement with reference to either Southeast Asia or Western Europe.|「二十世紀下半葉出現了由外來支配走向更大自主權的趨勢。」參考東南亞或西歐，說明此說。|8|Examine movement from external domination towards autonomy.|考察由外來支配走向自主的轉變趨勢。
‘Major wars destroyed existing international arrangements, but also encouraged new attempts at international cooperation.’ Elaborate on this statement with reference to the First and Second World Wars and their aftermaths. Limit your discussion to the period 1914–60.|「大型戰爭破壞了既有的國際安排，但亦促進了新的國際合作嘗試。」參考第一次及第二次世界大戰及其戰後發展，闡述此說。討論限於1914–60年。|9|Explain wars’ destruction of existing arrangements and encouragement of new cooperation.|解釋戰爭破壞既有安排及促進新合作這兩方面。
Which was more important in bringing about political transformation: the leadership of individuals or popular movements? Explain your view with reference to either the communist revolution in China in the period 1921–49 or the ending of apartheid in South Africa in the period 1960–94.|在促成政治轉變方面，個人領導與群眾運動哪一者更為重要？參考1921–49年間中國的共產革命，或1960–94年間南非種族隔離制度的結束，解釋你的看法。|4|Weigh individual leadership against popular movements as causes of political transformation.|比較個人領導與群眾運動對政治轉變的相對重要性。
Select either ASEAN or the European Economic Community/European Union. Trace and explain the expansion of its membership and areas of cooperation from its establishment to 2000.|選取東盟或歐洲經濟共同體／歐洲聯盟，追溯並解釋其由成立至2000年間會員及合作領域的擴展。|2|Trace and explain organisational expansion in membership and areas of cooperation.|按時間追溯並解釋組織會員及合作領域的擴展。
`;

function prepare(raw) {
    let answer;

    if (
        raw.recognitionType !== undefined &&
        String(raw.recognitionType).trim() !== ""
    ) {
        const value = String(raw.recognitionType).trim();

        answer = LABELS.indexOf(value);

        if (answer < 0) answer = LABELS_ZH.indexOf(value);
    } else {
        answer = raw.answer;
    }

    if (
        !Number.isInteger(answer) ||
        answer < 0 ||
        answer >= LABELS.length
    ) {
        throw new Error(
            "Essay: Revised type must be one of the full question-type names."
        );
    }

    return {
        ...raw,
        theme: "SKILLS",
        topic: TOPIC,
        type: "mc",
        subtopic: "Essay",
        choices: [...LABELS],
        answer,
        ...(raw.zh ? {
            zh: {
                ...raw.zh,
                subtopic: "論述題",
                choices: [...LABELS_ZH]
            }
        } : {})
    };
}

function seedRows() {
    const rows = DATA.trim().split("\n");

    if (rows.length !== 100) {
        throw new Error(
            `The Essay recognition bank must contain 100 rows, not ${rows.length}.`
        );
    }

    return rows.map((line, index) => {
        const fields = line.split("|");

        if (fields.length !== 5) {
            throw new Error(
                `Invalid Essay recognition data at row ${index + 1}.`
            );
        }

        const [prompt, promptZh, number, task, taskZh] = fields;
        const answer = Number(number);
        const rule = RULES[answer];

        if (!rule) {
            throw new Error(
                `Invalid Essay answer at row ${index + 1}.`
            );
        }

        return prepare({
            id: `QUESTION-TYPE-ESSAY-MC-${String(index + 1).padStart(4, "0")}`,
            prompt,
            explanation:
                `${LABELS[answer]}\n${task}\n${rule[0]}`,
            active: true,
            demo: false,
            answer,
            zh: {
                prompt: promptZh,
                explanation:
                    `${LABELS_ZH[answer]}\n${taskZh}\n${rule[1]}`
            }
        });
    });
}

module.exports = {
    TOPIC,
    LABELS,
    LABELS_ZH,
    prepare,
    seedRows
};