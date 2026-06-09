import re

def normalize_text(text: str) -> str:
    """
    Cleans and normalizes extracted text content by:
    1. Standardizing line endings to \n
    2. Stripping trailing whitespaces on each line
    3. Collapsing excessive consecutive blank lines (max 2 consecutive newlines)
    4. Stripping leading/trailing spaces of the overall document
    """
    if not text:
        return ""
    
    # 1. Standardize line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    
    # 2. Strip trailing whitespaces on each line
    lines = [line.rstrip() for line in text.split("\n")]
    
    # 3. Join and collapse consecutive empty lines
    normalized_text = "\n".join(lines)
    normalized_text = re.sub(r'\n{3,}', '\n\n', normalized_text)
    
    # 4. Strip overall document
    return normalized_text.strip()


def structure_to_json(filename: str, mime_type: str, raw_text: str) -> dict:
    """
    Parses flat text using regular expressions and returns a structured dictionary
    suitable for JSON representation on the UI.
    """
    data = {
        "metadata": {
            "filename": filename,
            "mime_type": mime_type,
            "status": "success" if "Error occurred" not in raw_text else "failed"
        },
        "raw_text": raw_text,
        "structured_data": {
            "invoice_number": None,
            "invoice_date": None,
            "total_amount": None,
            "emails": [],
            "dates": [],
            "extracted_key_values": {}
        }
    }
    
    if data["metadata"]["status"] == "failed" or not raw_text:
        return data
        
    # 1. Extract emails
    emails = list(set(re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', raw_text)))
    data["structured_data"]["emails"] = sorted(emails)
    
    # 2. Extract dates (YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY)
    dates = list(set(re.findall(r'\b(?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}|\d{2}/\d{2}/\d{4})\b', raw_text)))
    data["structured_data"]["dates"] = sorted(dates)
    
    # 3. Extract key-value lines (e.g., Key: Value)
    key_values = {}
    lines = raw_text.split('\n')
    for line in lines:
        match = re.match(r'^\s*([A-Za-z0-9\s_&/\-+\(\)#@\.]+)\s*:\s*(.+)$', line)
        if match:
            k = match.group(1).strip()
            v = match.group(2).strip()
            if v and len(k) < 50:
                key_values[k] = v
                
    # 4. Advanced Resume & Candidate Details Extraction Heuristics
    is_resume = any(term in filename.lower() or term in raw_text.lower() for term in ['resume', 'curriculum vitae', 'cv', 'biodata', 'experience', 'education', 'skills'])
    
    if is_resume:
        # Extract Candidate Name (first non-empty line matching name pattern in first 3 lines)
        candidate_name = None
        cand_lines = [l.strip() for l in raw_text.split('\n') if l.strip()]
        for line in cand_lines[:3]:
            if re.match(r'^[A-Za-z\s]{3,35}$', line):
                if not any(term in line.lower() for term in ['resume', 'curriculum', 'vitae', 'cv', 'page', 'email', 'phone', 'contact']):
                    candidate_name = line
                    break
        
        # Extract Phone Number (10 to 13 digits with space/dashes/country code)
        phone = None
        phone_matches = re.findall(r'\+?\d{1,4}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}', raw_text)
        for p in phone_matches:
            digits = re.sub(r'\D', '', p)
            if 10 <= len(digits) <= 13:
                phone = p.strip()
                break
                
        # Extract Social Links
        links = re.findall(r'https?://[a-zA-Z0-9./_-]+', raw_text)
        profiles = []
        for link in links:
            if 'linkedin.com' in link or 'github.com' in link:
                profiles.append(link)
                
        # Extract Programming/Technical Skills
        tech_keywords = ['python', 'javascript', 'typescript', 'react', 'react.js', 'node.js', 'express', 'fastapi', 'flask', 'django', 'postgresql', 'mysql', 'mongodb', 'sqlite', 'sqlalchemy', 'docker', 'aws', 'gcp', 'html', 'css', 'git', 'github', 'jwt', 'redux', 'angular', 'vue', 'kubernetes', 'linux', 'tailwinds', 'bootstrap', 'next.js']
        skills_found = []
        lower_text = raw_text.lower()
        for skill in tech_keywords:
            pattern = r'\b' + re.escape(skill) + r'\b'
            if re.search(pattern, lower_text):
                formatted_skill = skill.title().replace('Js', 'JS').replace('Aws', 'AWS').replace('Gcp', 'GCP').replace('Html', 'HTML').replace('Css', 'CSS').replace('Jwt', 'JWT')
                skills_found.append(formatted_skill)
                
        if candidate_name:
            key_values["Candidate Name"] = candidate_name
        if phone:
            key_values["Phone Number"] = phone
        if skills_found:
            key_values["Skills Extracted"] = ", ".join(skills_found)
        if profiles:
            key_values["Social Profiles"] = ", ".join(profiles)
            
    data["structured_data"]["extracted_key_values"] = key_values
    
    # 5. Attempt mapping of standard fields
    for k, v in key_values.items():
        k_lower = k.lower()
        if any(term in k_lower for term in ['invoice number', 'invoice no', 'inv no', 'invoice #', 'bill no']):
            data["structured_data"]["invoice_number"] = v
        elif any(term in k_lower for term in ['invoice date', 'date', 'bill date']):
            data["structured_data"]["invoice_date"] = v
        elif any(term in k_lower for term in ['total amount', 'amount due', 'total due', 'total', 'amount']):
            data["structured_data"]["total_amount"] = v
            
    # Fallback for total_amount from raw text if not found in key-value matching (with Multi-Currency support)
    if not data["structured_data"]["total_amount"]:
        amounts = re.findall(r'(?:[\$\u20B9\u20AC\u00A3]|Rs\.?|INR)\s*[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?', raw_text)
        if amounts:
            data["structured_data"]["total_amount"] = amounts[0]
            
    return data
