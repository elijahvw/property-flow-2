import React from 'react';

const About: React.FC = () => {
  return (
    <div className="page about-section">
      <div className="content-card">
        <h1>About PropertyFlow</h1>
        <p>PropertyFlow was built with a single mission: to make property management accessible, modern, and efficient.</p>
        
        <div className="about-grid">
          <div className="info-block">
            <h3>Our Vision</h3>
            <p>To be the leading platform for independent property owners worldwide.</p>
          </div>
          <div className="info-block">
            <h3>Our Values</h3>
            <p>Transparency, efficiency, and user-centric design are at our core.</p>
          </div>
        </div>
        
        <div className="cta-block">
          <p>Want to join our journey?</p>
          <button className="btn-primary">Contact Us</button>
        </div>
      </div>
    </div>
  );
};

export default About;
