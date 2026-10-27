// server/data/courseCatalog.js
//
// Predefined SSDC course/subject catalog, semester-wise.
// Compiled from SSDC's official syllabus pages (ssdc.ac.in). Where SSDC has published a
// program name but its syllabus PDF could not be read to extract subjects, that program is
// still listed (so faculty can select the course) but its `semesters` are left empty and a
// `note` explains why — nothing is invented. Faculty can fill these gaps in from the app via
// "Add a new course" / "Add a subject", which is exactly what those features are for.

const CATALOG = [
  {
    key: 'bca',
    name: 'BCA (Bachelor of Computer Applications)',
    degreeType: 'UG',
    totalSemesters: 6,
    semesters: {
      'Semester 1': [
        'Mathematical Foundations of CS', 'Digital Principles', 'Programming in C',
        'Introduction to Web Technology', 'Effective Communication',
        'Programming in C Lab', 'Web Technology Lab', 'IT Workshop'
      ],
      'Semester 2': [
        'Fundamentals of Probability & Statistics', 'Object Oriented Programming using C++',
        'Computer Architecture', 'Data Structures', 'Advance Computer Networks',
        'OOP using C++ Lab', 'Data Structures Lab', 'Communication Skills Lab'
      ],
      'Semester 3': [
        'Applied Mathematics', 'Environmental Science', 'Java Programming',
        'Operating System Concepts', 'Database Design',
        'Java Programming Lab', 'Operating System Concepts Lab', 'Database Design Lab'
      ],
      'Semester 4': [
        'Distributed and Cloud Computing', 'Network Security', 'Software Engineering',
        'Data Science using Python', 'Artificial Intelligence',
        'Data Science using Python Lab', 'Software Engineering Lab', 'Computer Networks Lab'
      ],
      'Semester 5': [
        'Programming using ASP.NET', 'Unix Programming', 'Object Oriented Systems Development',
        'Software Quality Testing', 'Elective 1: a) Mobile App Dev b) Internet Protocol c) Data Mining',
        'OOSD Lab', 'Unix Programming Lab', 'DOT NET Lab'
      ],
      'Semester 6': [
        'Information Security', 'Advanced Java Programming',
        'Elective 2: a) Big Data Analytics b) IoT & Applications c) Machine Learning',
        'Advanced Java Programming Lab', 'Project Work'
      ]
    }
  },
  {
    key: 'bcom-computer-applications',
    name: 'B.Com (Computer Applications)',
    degreeType: 'UG',
    totalSemesters: 6,
    semesters: {
      'Semester 1': [
        'English (First Language)', 'Second Language', 'Environmental Science / Basic Computer Skills',
        'Financial Accounting–I', 'Business Organization and Management', 'Fundamentals of Information Technology'
      ],
      'Semester 2': [
        'English (First Language)', 'Second Language', 'Basic Computer Skills / Environmental Science',
        'Financial Accounting–II', 'Business Laws', 'Programming with C & C++'
      ],
      'Semester 3': [
        'English (First Language)', 'Second Language', 'Communication Skills / Professional Skills',
        'Principles of Insurance / Foundation of Digital Marketing & Web Design', 'Advanced Accounting',
        'Business Statistics-I', 'Relational Database Management System'
      ],
      'Semester 4': [
        'English (First Language)', 'Second Language', 'Leadership & Management Skills / Universal Human Values',
        'Practice of Life and General Insurance / Social Media Marketing, Search Engine Optimization & Online Advertising',
        'Income Tax', 'Business Statistics-II', 'Web Technologies'
      ],
      'Semester 5': [
        'English (First Language)', 'Second Language', 'Business Economics / Advanced Aspects of Income Tax',
        'Cost Accounting / Financial Planning & Performance / International Financial Reporting-I',
        'Computerized Accounting / Financial Decision Making-I / International Tax & Regulation',
        'Management Information Systems / Ecommerce / Mobile Applications'
      ],
      'Semester 6': [
        'English (First Language)', 'Second Language', 'Research Methodology and Project Report',
        'Cost Control and Management Accounting / Financial Control / International Financial Reporting-II',
        'Theory and Practice of GST / Financial Decision Making-II / International Auditing',
        'Multimedia Systems / Cyber Security / Data Analytics'
      ]
    }
  },
  {
    key: 'bcom-honours',
    name: 'B.Com (Honours)',
    degreeType: 'UG',
    totalSemesters: 6,
    semesters: {
      'Semester 1': [
        'English (First Language)', 'AECC1: a) Environmental Science / b) Basic Computer Skills',
        'Financial Accounting-I', 'Business Organization and Management', 'Foreign Trade', 'Business Economics'
      ],
      'Semester 2': [
        'English (First Language)', 'AECC2: a) Basic Computer Skills / b) Environmental Science',
        'Financial Accounting-II', 'Business Laws', 'Banking and Financial Services', 'Financial Management'
      ],
      'Semester 3': [
        'English (First Language)', 'SEC1: Communication Skills / Professional Skills',
        'SEC2: a) Principles of Insurance / b) Foundation of Digital Marketing & Web Design',
        'Advanced Accounting', 'Business Statistics-I', 'Financial Institutions and Markets', 'Investment Management'
      ],
      'Semester 4': [
        'English (First Language)', 'SEC3: Leadership & Management Skills / Universal Human Values',
        'SEC4: a) Practice of Life and General Insurance / b) Social Media Marketing, Search Engine Optimization & Online Advertising',
        'Income Tax', 'Business Statistics-II', 'Corporate Accounting', 'Human Resource Management'
      ],
      'Semester 5': [
        'English (First Language)', 'GE: a) Excel Foundation / b) Advanced Aspects of Income Tax',
        'DSE501: a) Cost Accounting / b) Financial Planning & Performance / c) International Financial Reporting-I',
        'DSE502: a) Computerized Accounting / b) Financial Decision Making-I / c) International Tax & Regulation',
        'DSE503: a) Auditing / b) Strategic Management / c) Investment Industry-I',
        'DSE504: a) Marketing Management / b) Project and Relationship Management / c) Investment Instruments'
      ],
      'Semester 6': [
        'English (First Language)', 'PR: Research Methodology and Project Report',
        'DSE601: a) Cost Control and Management Accounting / b) Financial Control / c) International Financial Reporting-II',
        'DSE602: a) Theory and Practice of GST / b) Financial Decision Making-II / c) International Auditing',
        'DSE603: a) Accounting Standards / b) Corporate Governance / c) Investment Industry-II',
        'DSE604: a) International Finance / b) Business Applications of Emerging Technologies / c) Investment Industry Controls'
      ]
    }
  },
  {
    key: 'bcom-business-analytics',
    name: 'B.Com (Business Analytics)',
    degreeType: 'UG',
    totalSemesters: 6,
    semesters: {
      'Semester 1': [
        'English (First Language)', 'Second Language', 'Environmental Science / Basic Computer Skills',
        'Financial Accounting-I', 'Business Organization and Management', 'Data-driven Decision Making'
      ],
      'Semester 2': [
        'English (First Language)', 'Second Language', 'Basic Computer Skills / Environmental Science',
        'Financial Accounting-II', 'Business Laws', 'Data Analytics Essentials'
      ],
      'Semester 3': [
        'English (First Language)', 'Second Language', 'Communication Skills / Professional Skills',
        'Principles of Insurance / Foundation of Digital Marketing & Web Design', 'Advanced Accounting',
        'Business Statistics-I', 'Data Analytics Modeling'
      ],
      'Semester 4': [
        'English (First Language)', 'Second Language', 'Leadership & Management Skills / Universal Human Values',
        'Practice of Life and General Insurance / Social Media Marketing, Search Engine Optimization & Online Advertising',
        'Income Tax', 'Business Statistics-II', 'Forecasting & Predictive Analytics'
      ],
      'Semester 5': [
        'English (First Language)', 'Second Language', 'Business Economics / Advanced Aspects of Income Tax',
        'DSE501: a) Cost Accounting / b) Financial Planning & Performance / c) International Financial Reporting-I',
        'DSE502: a) Computerized Accounting / b) Financial Decision Making-I / c) International Tax & Regulation',
        'DSE503: a) Advanced Data Visualization / b) Advanced Corporate Accounting / c) Financial Management'
      ],
      'Semester 6': [
        'English (First Language)', 'Second Language', 'Research Methodology and Project Report',
        'DSE601: a) Cost Control and Management Accounting / b) Financial Control / c) International Financial Reporting-II',
        'DSE602: a) Theory and Practice of GST / b) Financial Decision Making-II / c) International Auditing',
        'DSE603: a) Business Applications of Emerging Technologies / b) Corporate Governance / c) Investment Management'
      ]
    }
  },
  {
    key: 'bba',
    name: 'BBA (Bachelor of Business Administration)',
    degreeType: 'UG',
    totalSemesters: 6,
    semesters: {
      'Semester 1': [
        'English (First Language) – 1', 'Second Language – 1', 'Environmental Studies',
        'Principles of Management', 'Basics of Marketing', 'Business Economics'
      ],
      'Semester 2': [
        'English (First Language) – 2', 'Second Language – 2', 'Basic Computer Skills',
        'Organizational Behavior', 'Business Statistics', 'Financial Accounting'
      ],
      'Semester 3': [
        'English (First Language) – 3', 'Second Language – 3', 'Communication Skills / Professional Skills',
        'Basic Quality Management / Advanced Computer Skills', 'Human Resource Management',
        'Introduction to Information Technology', 'Financial Management'
      ],
      'Semester 4': [
        'English (First Language) – 4', 'Second Language – 4', 'Leadership and Management Skills / Universal Human Values',
        'Start Up Opportunity and Feasibility / Business Policy and Strategy', 'Business Law and Ethics',
        'Marketing Research', 'Management Science'
      ],
      'Semester 5': [
        'English (First Language) – 5', 'Second Language – 5', 'Mobile Commerce',
        'Entrepreneurship Development / Business Analytics',
        'Specialization Elective 1 (Finance: Financial Markets and Services / Marketing: Brand Management / HR: Organizational Development / Retail Management: Fundamentals of Retail Management)',
        'Specialization Elective 2 (Finance: Analysis of Investment in Financial Assets / Marketing: Retail Marketing / HR: Performance Appraisal and Counseling / Retail Management: Retail Mall Management)'
      ],
      'Semester 6': [
        'English (First Language) – 6', 'Second Language – 6',
        'Supply Chain Management / Business Intelligence and Data Visualization',
        'Specialization Elective 3 (Finance: Banking / Marketing: Buyer Behaviour / HR: Leadership and Change Management / Retail Management: Global Retailing and Merchandizing)',
        'Specialization Elective 4 (Finance: Insurance / Marketing: Customer Relationship Management / HR: Compensation Management / Retail Management: Retail Store Operations and Pricing)',
        'Project Report', 'Viva Voce'
      ]
    }
  },
  {
    key: 'bba-business-analytics',
    name: 'BBA (Business Analytics)',
    degreeType: 'UG',
    totalSemesters: 6,
    semesters: {
      'Semester 1': [
        'English (First Language) - 1', 'Second Language - 1', 'Environmental Studies',
        'Principles of Management', 'Business Mathematics', 'Introduction to Information Technology'
      ],
      'Semester 2': [
        'English (First Language) - 2', 'Second Language - 2', 'Basic Computer Skills',
        'Business Economics', 'Financial Accounting', 'Introduction to Business Analytics'
      ],
      'Semester 3': [
        'English (First Language) - 3', 'Second Language - 3', 'Communication Skills / Professional Skills',
        'Basic Quality Management / Advanced Computer Skills', 'Basics of Marketing',
        'Management Science', 'Descriptive Business Analytics'
      ],
      'Semester 4': [
        'English (First Language) - 4', 'Second Language - 4', 'Leadership and Management Skills / Universal Human Values',
        'Business Policy & Strategy / Business Laws', 'Human Resource Management',
        'Financial Management', 'Predictive Business Analytics'
      ],
      'Semester 5': [
        'English (First Language) - 5', 'Second Language - 5', 'Entrepreneurship Development',
        'DSE501: a) Big Data Analytics b) Data Warehousing & Data Mining',
        'DSE502: a) Financial Markets and Services (F) b) Brand Management (M) c) Organizational Development (HR)',
        'DSE503: a) Financial Analytics-I (F) b) Marketing Analytics-I (M) c) HR Analytics-I (HR)'
      ],
      'Semester 6': [
        'English (First Language) - 6', 'Second Language - 6',
        'DSC601: a) Business Intelligence & Data Visualization b) Business Analytics Programming',
        'DSE602: a) Banking (F) b) Buyer Behaviour (M) c) Leadership and Change Management (HR)',
        'DSE603: a) Financial Analytics-II (F) b) Marketing Analytics-II (M) c) HR Analytics-II (HR)',
        'Project Report', 'Comprehensive Viva-Voce'
      ]
    }
  },
  {
    key: 'bsc-honours-cs',
    name: 'B.Sc (Honours in Computer Science)',
    degreeType: 'UG Honours',
    totalSemesters: 8,
    semesters: {
      'Semester 1': [
        'English (First Language)', 'Environmental Science', 'Fundamentals of IT', 'Programming with C',
        'Calculus and Differential Equations', 'Statistics & Probability Models & R Lab',
        'Calculus using MATLAB', 'Stats & Probability using R Lab'
      ],
      'Semester 2': [
        'English (First Language)', 'Fundamentals of Computers', 'Algebra', 'Statistical Inference & R Prog Lab',
        'Computer Organization', 'Problem Solving & Python Programming', 'Mini Project (Computers)',
        'MATLAB and R Programming Lab'
      ],
      'Semester 3': [
        'English (First Language)', 'Communication/Professional Skills', 'Discrete Mathematics & MATLAB',
        'Statistical Methods & Adv. R Prog Lab', 'Linux Tools and Utilities', 'Data Structures and Algorithms',
        'OOP using Java', 'Mini Project (Computers)'
      ],
      'Semester 4': [
        'English (First Language)', 'Leadership & Mgmt / Human Values', 'Real Analysis & MATLAB',
        'Optimization Techniques (R Prog)', 'Operating Systems', 'Database Management Systems',
        'Mini Project (Computers)', 'Mini Project (Statistics)'
      ],
      'Semester 5': [
        'Number Theory', 'Linear Algebra & MATLAB', 'Fundamentals of Cyber Security', 'Artificial Intelligence',
        'Data Modeling via ML Techniques', 'Web Programming',
        'Elective 1: 1) Info Retrieval Systems 2) Image Processing', 'Mini Project (Computers)'
      ],
      'Semester 6': [
        'SciLab', 'Design and Analysis of Algorithms', 'Data Mining using Python', 'Software Engineering',
        'Elective 2: 1) Big Data 2) NLP', 'Deep Learning', 'Project Work'
      ],
      'Semester 7': [
        'Research Methodology', 'Cloud Computing', 'Computer Networks',
        'Elective 3: 1) Cryptography 2) Enterprise Systems', 'Selenium: Automated Testing for Web Apps',
        'Project Work / Industry Internship Phase-I'
      ],
      'Semester 8': [
        'Project Work / Industry Internship Phase-II'
      ]
    }
  },
  {
    key: 'bsc-cs-cyber-security',
    name: 'B.Sc (Honours) — Computer Science & Cyber Security (MSCS)',
    degreeType: 'UG Honours',
    totalSemesters: 6,
    semesters: {
      'Semester 1': [
        'English (First Language)', 'Second Language (Sanskrit/Hindi)', 'Environmental Science',
        'Diff. & Integral Calculus & MATLAB', 'Descriptive Stats & Probability, Adv. Excel/R Lab',
        'Programming in C'
      ],
      'Semester 2': [
        'English (First Language)', 'Second Language', 'Fundamentals of Computers',
        'Differential Equations & MATLAB', 'Probability Distributions, Adv. Excel/R Lab',
        'Programming in C++', 'Mini Project (Computers)'
      ],
      'Semester 3': [
        'English (First Language)', 'Second Language', 'Communication/Professional Skills',
        'Real Analysis & MATLAB', 'Statistical Inference & Adv. R Lab', 'Information Technology',
        'Programming in Java', 'Python Programming'
      ],
      'Semester 4': [
        'English (First Language)', 'Second Language', 'Leadership & Mgmt / Human Values',
        'Algebra & MATLAB', 'Correlation/Regression & Exp. Designs, R Lab', 'Database Management Systems',
        'OOP using Python', 'Mini Project (Computers)'
      ],
      'Semester 5': [
        'English (First Language)', 'Second Language', 'Machine Learning', 'Linear Algebra & MATLAB',
        'Sample Theory & Operations Research + Lab', 'Data Structures & Algorithms', 'Cyber Security',
        'Mini Project (Computers)'
      ],
      'Semester 6': [
        'English (First Language)', 'Second Language', 'Web Technologies', 'Industrial Statistics & Lab',
        'Numerical Analysis / Integral Transforms / Solid Geometry & MATLAB', 'PHP with MySQL / CS Project'
      ]
    }
  },
  {
    key: 'bsc-data-science',
    name: 'B.Sc (Data Science)',
    degreeType: 'UG',
    totalSemesters: 6,
    semesters: {
      'Semester 1': [
        'English (First Language)', 'Second Language', 'Environmental Science',
        'Diff. & Integral Calculus & MATLAB', 'Descriptive Stats & Probability, Adv. Excel/R Lab',
        'Problem Solving & Python Programming'
      ],
      'Semester 2': [
        'English (First Language)', 'Second Language', 'Fundamentals of Computers',
        'Differential Equations & MATLAB', 'Probability Distributions, Adv. Excel/R Lab',
        'Data Structures & Algorithms using Python', 'Mini Project (Data Science)'
      ],
      'Semester 3': [
        'English (First Language)', 'Second Language', 'Communication/Professional Skills',
        'Real Analysis & MATLAB', 'Statistical Inference & Adv. R Lab', 'Information Technology',
        'Data Engineering with Python', 'Mini Project (Statistics)'
      ],
      'Semester 4': [
        'English (First Language)', 'Second Language', 'Leadership & Mgmt / Human Values',
        'Algebra & MATLAB', 'Correlation/Regression & Exp. Designs, R Lab', 'Web Technology',
        'Programming in Java', 'Mini Project (Data Science)'
      ],
      'Semester 5': [
        'English (First Language)', 'Second Language', 'NoSQL Database', 'Linear Algebra & MATLAB',
        'Sample Theory & Operations Research + Lab', 'Machine Learning', 'Mini Project (Data Science)'
      ],
      'Semester 6': [
        'English (First Language)', 'Second Language', 'Deep Learning', 'Industrial Statistics & Lab',
        'Numerical Analysis / Integral Transforms / Solid Geometry & MATLAB', 'Data Science Project'
      ]
    }
  },
  {
    key: 'bsc-ai-ml',
    name: 'B.Sc (AI & ML)',
    degreeType: 'UG',
    totalSemesters: 6,
    semesters: {
      'Semester 1': [
        'English (First Language)', 'Second Language (Sanskrit/Hindi/Telugu)', 'Environmental Science',
        'Diff. & Integral Calculus & MATLAB', 'Descriptive Stats & Probability, Adv. Excel/R Lab',
        'Fundamentals of IT'
      ],
      'Semester 2': [
        'English (First Language)', 'Second Language', 'Fundamentals of Computers',
        'Differential Equations & MATLAB', 'Probability Distributions, Adv. Excel/R Lab',
        'OOP using Python', 'Mini Project (Computers)'
      ],
      'Semester 3': [
        'English (First Language)', 'Second Language', 'Communication/Professional Skills',
        'Real Analysis & MATLAB', 'Statistical Inference & Adv. R Lab', 'Web Design',
        'Operating System with Linux', 'Natural Language Processing'
      ],
      'Semester 4': [
        'English (First Language)', 'Second Language', 'Leadership & Mgmt / Human Values',
        'Algebra & MATLAB', 'Correlation/Regression & Exp. Designs, R Lab', 'MySQL Database',
        'Data Interpretation', 'Mini Project (Computers)'
      ],
      'Semester 5': [
        'English (First Language)', 'Second Language', 'NoSQL Database', 'Linear Algebra & MATLAB',
        'Sample Theory & Operations Research + Lab', 'Artificial Intelligence', 'Mini Project (Computers)'
      ],
      'Semester 6': [
        'English (First Language)', 'Second Language',
        'Numerical Analysis / Integral Transforms / Solid Geometry & MATLAB', 'Industrial Statistics & Lab',
        'Machine Learning', 'Major Project'
      ]
    }
  }
];

module.exports = CATALOG;
