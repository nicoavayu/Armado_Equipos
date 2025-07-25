import React, { useState, useEffect } from 'react';
import './WeatherWidget.css';

const WeatherWidget = ({ compact = false }) => {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);

  // Poné tu API key acá 👇
  const API_KEY = '296151bbadcc8b6ffb72992feb761554';
  const API_BASE = 'https://api.openweathermap.org/data/2.5/weather';

  // Obtiene clima por coordenadas
  const fetchWeatherByCoords = async (lat, lon) => {
    try {
      const response = await fetch(
        `${API_BASE}?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=es`,
      );
      const data = await response.json();

      if (response.ok) {
        setWeather({
          city: data.name,
          temperature: Math.round(data.main.temp),
          description: data.weather[0].description,
          icon: data.weather[0].icon,
        });
      } else {
        fetchWeatherByCity('Buenos Aires');
      }
    } catch (err) {
      fetchWeatherByCity('Buenos Aires');
    }
  };

  // Obtiene clima por ciudad (fallback)
  const fetchWeatherByCity = async (cityName) => {
    try {
      const response = await fetch(
        `${API_BASE}?q=${cityName}&appid=${API_KEY}&units=metric&lang=es`,
      );
      const data = await response.json();

      if (response.ok) {
        setWeather({
          city: data.name,
          temperature: Math.round(data.main.temp),
          description: data.weather[0].description,
          icon: data.weather[0].icon,
        });
      }
    } catch (err) {
      setWeather({
        city: 'Buenos Aires',
        temperature: 22,
        description: 'Soleado',
        icon: '01d',
      });
    }
  };

  // Solicita geolocalización al montar
  const requestLocation = () => {
    if (!navigator.geolocation) {
      fetchWeatherByCity('Buenos Aires');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        fetchWeatherByCoords(
          position.coords.latitude,
          position.coords.longitude,
        );
      },
      () => {
        fetchWeatherByCity('Buenos Aires');
      },
      {
        timeout: 10000,
        enableHighAccuracy: true,
        maximumAge: 300000,
      },
    );
  };

  // Map de iconos OWM a emoji
  const getWeatherIcon = (iconCode) => {
    if (!iconCode) return '☀️';
    const iconMap = {
      '01d': '☀️', '01n': '🌙',
      '02d': '⛅', '02n': '⛅',
      '03d': '☁️', '03n': '☁️',
      '04d': '☁️', '04n': '☁️',
      '09d': '🌧️', '09n': '🌧️',
      '10d': '🌦️', '10n': '🌦️',
      '11d': '⛈️', '11n': '⛈️',
      '13d': '❄️', '13n': '❄️',
      '50d': '🌫️', '50n': '🌫️',
    };

    return iconMap[iconCode] || '☀️';
  };


  useEffect(() => {
    setLoading(true);
    requestLocation();
  }, []);

  useEffect(() => {
    if (weather) setLoading(false);
  }, [weather]);

  return (
    <div className={`weather-widget ${compact ? 'compact' : ''}`}>
      {loading ? (
        <div className="weather-loading">
          <span>📍 Obteniendo clima...</span>
        </div>
      ) : (
        <div className="weather-content">
          <span className="weather-city-name">
            {weather?.city || 'Ciudad'}
          </span>
          <span className="weather-icon">
            {getWeatherIcon(weather?.icon)}
          </span>
          <span className="weather-temperature">
            {weather?.temperature || '--'}°C
          </span>
        </div>
      )}
    </div>
  );
};

export default WeatherWidget;
